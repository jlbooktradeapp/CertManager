import nodemailer from 'nodemailer';
import { createMailTransporter, getMailConfig } from '../config/mail';
import { Certificate, ICertificate } from '../models/Certificate';
import { NotificationSettings } from '../models/NotificationSettings';
import { User } from '../models/User';
import { logger } from '../utils/logger';

// Escape HTML special characters to prevent HTML injection in emails
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface NotificationResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

export async function sendExpirationNotifications(): Promise<NotificationResult> {
  const result: NotificationResult = {
    success: true,
    sent: 0,
    failed: 0,
    errors: [],
  };

  try {
    const settings = await NotificationSettings.findOne();

    if (!settings || !settings.enabled) {
      logger.info('Notifications are disabled');
      return result;
    }

    const enabledThresholds = settings.thresholds
      .filter(t => t.enabled)
      .map(t => t.days)
      .sort((a, b) => b - a);

    if (enabledThresholds.length === 0) {
      logger.info('No notification thresholds enabled');
      return result;
    }

    // Get recipients
    const recipients = await resolveRecipients(settings.recipients);

    if (recipients.length === 0) {
      logger.warn('No notification recipients configured');
      return result;
    }

    // Check each threshold
    for (const days of enabledThresholds) {
      const expiringCerts = await findCertificatesExpiringInDays(days);

      for (const cert of expiringCerts) {
        // Check if notification was already sent for this threshold
        const alreadySent = cert.notificationsSent.some(
          n => n.type === `${days}day` as any
        );

        if (alreadySent) {
          continue;
        }

        try {
          await sendExpirationEmail(cert, days, recipients, settings);

          // Record that notification was sent
          cert.notificationsSent.push({
            type: `${days}day` as any,
            sentAt: new Date(),
            recipients,
          });
          await cert.save();

          result.sent++;
          logger.info(`Sent ${days}-day expiration notice for ${cert.commonName}`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Failed to send for ${cert.commonName}: ${error}`);
          logger.error(`Failed to send notification for ${cert.commonName}:`, error);
        }
      }
    }
  } catch (error) {
    result.success = false;
    result.errors.push(`Notification job error: ${error}`);
    logger.error('Notification service error:', error);
  }

  return result;
}

async function findCertificatesExpiringInDays(days: number): Promise<ICertificate[]> {
  const now = new Date();
  const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const previousDay = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);

  return Certificate.find({
    status: { $ne: 'revoked' },
    validTo: {
      $gte: previousDay,
      $lte: targetDate,
    },
  });
}

async function resolveRecipients(
  recipients: { type: string; value: string }[]
): Promise<string[]> {
  const emails: Set<string> = new Set();

  for (const recipient of recipients) {
    switch (recipient.type) {
      case 'email':
        emails.add(recipient.value);
        break;

      case 'user':
        const user = await User.findOne({ username: recipient.value });
        if (user?.email) {
          emails.add(user.email);
        }
        break;

      case 'role':
        const users = await User.find({ roles: recipient.value });
        users.forEach(u => {
          if (u.email) emails.add(u.email);
        });
        break;
    }
  }

  return Array.from(emails);
}

async function sendExpirationEmail(
  cert: ICertificate,
  days: number,
  recipients: string[],
  settings: any
): Promise<void> {
  const transporter = createMailTransporter();
  const config = getMailConfig();

  const severity = days <= 7 ? 'CRITICAL' : days <= 30 ? 'WARNING' : 'INFO';
  const subject = `[${severity}] Certificate Expiring in ${days} Days: ${cert.commonName}`;

  const deployedServers = cert.deployedTo
    .map(d => escapeHtml(d.serverName))
    .join(', ') || 'Unknown';

  const html = `
    <html>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: ${severity === 'CRITICAL' ? '#d32f2f' : severity === 'WARNING' ? '#f57c00' : '#1976d2'}">
        Certificate Expiration Notice
      </h2>

      <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Certificate</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.commonName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Serial Number</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.serialNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Expiration Date</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.validTo.toLocaleDateString())}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Days Remaining</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${days}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Issuing CA</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.issuer.commonName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Deployed To</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${deployedServers}</td>
        </tr>
      </table>

      <p style="margin-top: 20px;">
        Please renew this certificate before it expires to prevent service disruption.
      </p>

      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        This is an automated message from Certificate Manager.
      </p>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: config.from,
    to: recipients.join(', '),
    subject,
    html,
  });
}

export async function sendTestEmail(to: string): Promise<boolean> {
  try {
    const transporter = createMailTransporter();
    const config = getMailConfig();

    await transporter.sendMail({
      from: config.from,
      to,
      subject: 'Certificate Manager - Test Email',
      html: `
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Test Email</h2>
          <p>This is a test email from Certificate Manager.</p>
          <p>If you received this, email notifications are configured correctly.</p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            Sent at: ${new Date().toISOString()}
          </p>
        </body>
        </html>
      `,
    });

    return true;
  } catch (error) {
    logger.error('Test email failed:', error);
    return false;
  }
}
