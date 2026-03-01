import { createMailTransporter, getMailConfig } from '../config/mail';
import { Certificate, ICertificate } from '../models/Certificate';
import { Application } from '../models/Application';
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

/**
 * Main entry point called by the scheduler.
 * Runs both the owner/vendor per-cert notifications and the admin daily digest.
 */
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

    // 1. Send per-cert threshold emails to app owners/vendors
    const ownerResult = await sendOwnerNotifications(settings);
    result.sent += ownerResult.sent;
    result.failed += ownerResult.failed;
    result.errors.push(...ownerResult.errors);

    // 2. Send daily digest to global admin recipients
    const digestResult = await sendAdminDigest(settings);
    result.sent += digestResult.sent;
    result.failed += digestResult.failed;
    result.errors.push(...digestResult.errors);

  } catch (error) {
    result.success = false;
    result.errors.push(`Notification job error: ${error}`);
    logger.error('Notification service error:', error);
  }

  return result;
}

// ─── OWNER/VENDOR PER-CERT NOTIFICATIONS ──────────────────────────────────────

/**
 * Send individual expiration emails to per-certificate recipients and
 * application owners/vendors at configured thresholds.
 * Global recipients are NOT included — they get the admin digest instead.
 */
async function sendOwnerNotifications(settings: any): Promise<NotificationResult> {
  const result: NotificationResult = { success: true, sent: 0, failed: 0, errors: [] };

  const enabledThresholds = settings.thresholds
    .filter((t: any) => t.enabled)
    .map((t: any) => t.days)
    .sort((a: number, b: number) => b - a);

  if (enabledThresholds.length === 0) {
    logger.info('No notification thresholds enabled');
    return result;
  }

  const excludedTemplates = settings.excludedTemplates || [];

  for (const days of enabledThresholds) {
    const expiringCerts = await findCertificatesExpiringInDays(days, excludedTemplates);

    for (const cert of expiringCerts) {
      // Check if notification was already sent for this threshold
      const alreadySent = cert.notificationsSent.some(
        (n: any) => n.type === `${days}day`
      );

      if (alreadySent) {
        continue;
      }

      // Build recipient list: per-cert recipients + app owner/vendor (NO global recipients)
      const certRecipients: string[] = [...(cert.notificationRecipients || [])];

      if (cert.applicationId) {
        const app = await Application.findById(cert.applicationId);
        if (app) {
          for (const owner of app.owners) {
            if (owner.email) certRecipients.push(owner.email);
          }
          if (app.vendor?.contactEmail) {
            certRecipients.push(app.vendor.contactEmail);
          }
        }
      }

      const allRecipients = [...new Set(certRecipients)];

      // Skip if no per-cert recipients (admins get the digest instead)
      if (allRecipients.length === 0) {
        continue;
      }

      try {
        await sendOwnerExpirationEmail(cert, days, allRecipients, settings);

        // Record that notification was sent
        cert.notificationsSent.push({
          type: `${days}day` as any,
          sentAt: new Date(),
          recipients: allRecipients,
        });
        await cert.save();

        result.sent++;
        logger.info(`Sent ${days}-day owner notification for ${cert.commonName} to ${allRecipients.length} recipients`);
      } catch (error) {
        result.failed++;
        result.errors.push(`Failed to send owner notification for ${cert.commonName}: ${error}`);
        logger.error(`Failed to send owner notification for ${cert.commonName}:`, error);
      }
    }
  }

  return result;
}

/**
 * Find certificates expiring within a given day window.
 * Excludes revoked, reissued, and excluded templates.
 */
async function findCertificatesExpiringInDays(days: number, excludedTemplates: string[]): Promise<ICertificate[]> {
  const now = new Date();
  const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const previousDay = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);

  const query: any = {
    status: { $nin: ['revoked', 'reissued', 'rebound'] },
    validTo: {
      $gte: previousDay,
      $lte: targetDate,
    },
  };

  if (excludedTemplates.length > 0) {
    query.templateName = { $nin: excludedTemplates };
  }

  return Certificate.find(query);
}

/**
 * Send an individual expiration email for a specific certificate.
 */
async function sendOwnerExpirationEmail(
  cert: ICertificate,
  days: number,
  recipients: string[],
  settings: any
): Promise<void> {
  const transporter = createMailTransporter();
  const config = getMailConfig();

  const severity = days <= 7 ? 'CRITICAL' : days <= 30 ? 'WARNING' : 'INFO';
  const subject = `[${severity}] Certificate Expiring in ${days} Days: ${cert.commonName}`;

  const appName = cert.applicationId
    ? (await Application.findById(cert.applicationId))?.name || 'Unknown'
    : 'Not Assigned';

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
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Application</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(appName)}</td>
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

// ─── ADMIN DAILY DIGEST ───────────────────────────────────────────────────────

/**
 * Send a single daily digest email to global (admin) recipients.
 * Contains three sections: Critical (≤7 days), Expiring (7-30 days),
 * and Recently Reissued (last 7 days).
 */
async function sendAdminDigest(settings: any): Promise<NotificationResult> {
  const result: NotificationResult = { success: true, sent: 0, failed: 0, errors: [] };

  // Resolve global recipients only
  const adminRecipients = await resolveRecipients(settings.recipients);

  if (adminRecipients.length === 0) {
    logger.info('No global recipients configured for admin digest');
    return result;
  }

  const excludedTemplates = settings.excludedTemplates || [];
  const now = new Date();

  // Build template exclusion filter
  const templateFilter: any = excludedTemplates.length > 0
    ? { templateName: { $nin: excludedTemplates } }
    : {};

  // Critical: expiring within 7 days (not yet expired)
  const criticalCerts = await Certificate.find({
    status: { $nin: ['revoked', 'reissued', 'rebound'] },
    validTo: {
      $gte: now,
      $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    ...templateFilter,
  }).sort({ validTo: 1 });

  // Expiring: expiring in 7-30 days
  const expiringCerts = await Certificate.find({
    status: { $nin: ['revoked', 'reissued', 'rebound'] },
    validTo: {
      $gt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
    ...templateFilter,
  }).sort({ validTo: 1 });

  // Recently reissued: marked as reissued in the last 7 days
  const reissuedCerts = await Certificate.find({
    status: 'reissued',
    updatedAt: {
      $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    },
    ...templateFilter,
  }).sort({ updatedAt: -1 }).limit(50);

  // Skip sending if there's nothing to report
  if (criticalCerts.length === 0 && expiringCerts.length === 0 && reissuedCerts.length === 0) {
    logger.info('Admin digest: nothing to report');
    return result;
  }

  try {
    await sendDigestEmail(adminRecipients, criticalCerts, expiringCerts, reissuedCerts);
    result.sent++;
    logger.info(`Sent admin digest to ${adminRecipients.length} recipients (${criticalCerts.length} critical, ${expiringCerts.length} expiring, ${reissuedCerts.length} reissued)`);
  } catch (error) {
    result.failed++;
    result.errors.push(`Failed to send admin digest: ${error}`);
    logger.error('Failed to send admin digest:', error);
  }

  return result;
}

/**
 * Build and send the digest email.
 */
async function sendDigestEmail(
  recipients: string[],
  criticalCerts: ICertificate[],
  expiringCerts: ICertificate[],
  reissuedCerts: ICertificate[]
): Promise<void> {
  const transporter = createMailTransporter();
  const config = getMailConfig();

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Determine subject severity
  let subjectPrefix = 'INFO';
  if (criticalCerts.length > 0) {
    subjectPrefix = 'CRITICAL';
  } else if (expiringCerts.length > 0) {
    subjectPrefix = '';
  }

  const subject = `Certificate Manager Daily Digest - ${today}`;

  // Preload application names for all certs
  const appIds = [...criticalCerts, ...expiringCerts, ...reissuedCerts]
    .filter(c => c.applicationId)
    .map(c => c.applicationId);
  const apps = appIds.length > 0
    ? await Application.find({ _id: { $in: appIds } })
    : [];
  const appMap = new Map(apps.map(a => [a._id.toString(), a]));

  const getAppName = (cert: ICertificate) => {
    if (!cert.applicationId) return '';
    const app = appMap.get(cert.applicationId.toString());
    return app?.name || '';
  };

  const getAppOwner = (cert: ICertificate) => {
    if (!cert.applicationId) return '';
    const app = appMap.get(cert.applicationId.toString());
    if (!app?.owners || app.owners.length === 0) return '';
    return app.owners.map((o: any) => o.name).join(', ');
  };

  const buildCertRow = (cert: ICertificate, showDays: boolean = true) => {
    const daysLeft = Math.ceil((cert.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const appName = getAppName(cert);
    const appOwner = getAppOwner(cert);
    const daysColor = daysLeft <= 7 ? '#d32f2f' : '#f57c00';

    return `
      <tr>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.commonName)}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.issuer.commonName)}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.templateName || 'N/A')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(appName || 'Not Assigned')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(appOwner || 'N/A')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.validTo.toLocaleDateString())}</td>
        ${showDays ? `<td style="padding: 6px 10px; border: 1px solid #ddd; color: ${daysColor}; font-weight: bold;">${daysLeft}d</td>` : ''}
      </tr>
    `;
  };

  const buildReissuedRow = (cert: ICertificate) => {
    const appName = getAppName(cert);
    const appOwner = getAppOwner(cert);
    return `
      <tr>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.commonName)}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.issuer.commonName)}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.templateName || 'N/A')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(appName || 'Not Assigned')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(appOwner || 'N/A')}</td>
        <td style="padding: 6px 10px; border: 1px solid #ddd;">${escapeHtml(cert.validTo.toLocaleDateString())}</td>
      </tr>
    `;
  };

  const tableHeaderStyle = 'padding: 8px 10px; border: 1px solid #ddd; background-color: #f5f5f5; font-weight: bold; text-align: left;';

  let html = `
    <html>
    <body style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
      <h2 style="color: #1976d2; margin-bottom: 5px;">Certificate Manager Daily Digest</h2>
      <p style="color: #666; margin-top: 0;">${today}</p>

      <table style="margin-bottom: 20px;">
        <tr>
          <td style="padding: 4px 12px; font-weight: bold;">Critical (≤ 7 days):</td>
          <td style="padding: 4px 12px; color: ${criticalCerts.length > 0 ? '#d32f2f' : '#4caf50'}; font-weight: bold;">${criticalCerts.length}</td>
        </tr>
        <tr>
          <td style="padding: 4px 12px; font-weight: bold;">Expiring (7-30 days):</td>
          <td style="padding: 4px 12px; color: ${expiringCerts.length > 0 ? '#f57c00' : '#4caf50'}; font-weight: bold;">${expiringCerts.length}</td>
        </tr>
        <tr>
          <td style="padding: 4px 12px; font-weight: bold;">Recently Reissued:</td>
          <td style="padding: 4px 12px; color: #1976d2; font-weight: bold;">${reissuedCerts.length}</td>
        </tr>
      </table>
  `;

  // Critical section
  if (criticalCerts.length > 0) {
    html += `
      <h3 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 4px;">
        🔴 Critical — Expiring Within 7 Days (${criticalCerts.length})
      </h3>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="${tableHeaderStyle}">Common Name</th>
            <th style="${tableHeaderStyle}">Issuing CA</th>
            <th style="${tableHeaderStyle}">Template</th>
            <th style="${tableHeaderStyle}">Application</th>
            <th style="${tableHeaderStyle}">Owner</th>
            <th style="${tableHeaderStyle}">Expires</th>
            <th style="${tableHeaderStyle}">Days Left</th>
          </tr>
        </thead>
        <tbody>
          ${criticalCerts.map(c => buildCertRow(c, true)).join('')}
        </tbody>
      </table>
    `;
  }

  // Expiring section
  if (expiringCerts.length > 0) {
    html += `
      <h3 style="color: #f57c00; border-bottom: 2px solid #f57c00; padding-bottom: 4px;">
        🟠 Expiring — Within 7-30 Days (${expiringCerts.length})
      </h3>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="${tableHeaderStyle}">Common Name</th>
            <th style="${tableHeaderStyle}">Issuing CA</th>
            <th style="${tableHeaderStyle}">Template</th>
            <th style="${tableHeaderStyle}">Application</th>
            <th style="${tableHeaderStyle}">Owner</th>
            <th style="${tableHeaderStyle}">Expires</th>
            <th style="${tableHeaderStyle}">Days Left</th>
          </tr>
        </thead>
        <tbody>
          ${expiringCerts.map(c => buildCertRow(c, true)).join('')}
        </tbody>
      </table>
    `;
  }

  // Reissued section
  if (reissuedCerts.length > 0) {
    html += `
      <h3 style="color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 4px;">
        🔵 Recently Reissued — Last 7 Days (${reissuedCerts.length})
      </h3>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="${tableHeaderStyle}">Common Name</th>
            <th style="${tableHeaderStyle}">Issuing CA</th>
            <th style="${tableHeaderStyle}">Template</th>
            <th style="${tableHeaderStyle}">Application</th>
            <th style="${tableHeaderStyle}">Owner</th>
            <th style="${tableHeaderStyle}">Expired</th>
          </tr>
        </thead>
        <tbody>
          ${reissuedCerts.map(c => buildReissuedRow(c)).join('')}
        </tbody>
      </table>
    `;
  }

  html += `
      <p style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px;">
        This is an automated daily digest from Certificate Manager.
      </p>
    </body>
    </html>
  `;

  // Build CSV attachment with all certificate data from the digest
  const csvRows: string[] = [];
  csvRows.push('Section,Common Name,Issuing CA,Template,Application,Owner,Expiration Date,Days Left,Serial Number,Thumbprint,SANs');

  const buildCsvRow = (section: string, cert: ICertificate) => {
    const daysLeft = Math.ceil((cert.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const appName = getAppName(cert);
    const appOwner = getAppOwner(cert);
    const sans = (cert.subjectAlternativeNames || []).join('; ');
    const esc = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
    return [
      esc(section),
      esc(cert.commonName),
      esc(cert.issuer.commonName),
      esc(cert.templateName || 'N/A'),
      esc(appName || 'Not Assigned'),
      esc(appOwner || 'N/A'),
      esc(cert.validTo.toLocaleDateString()),
      daysLeft.toString(),
      esc(cert.serialNumber),
      esc(cert.thumbprint),
      esc(sans),
    ].join(',');
  };

  criticalCerts.forEach(c => csvRows.push(buildCsvRow('Critical', c)));
  expiringCerts.forEach(c => csvRows.push(buildCsvRow('Expiring', c)));
  reissuedCerts.forEach(c => csvRows.push(buildCsvRow('Reissued', c)));

  const csvContent = csvRows.join('\n');
  const dateStr = new Date().toISOString().split('T')[0];

  await transporter.sendMail({
    from: config.from,
    to: recipients.join(', '),
    subject,
    html,
    attachments: [
      {
        filename: `certificate-digest-${dateStr}.csv`,
        content: csvContent,
        contentType: 'text/csv',
      },
    ],
  });
}

// ─── SHARED UTILITIES ─────────────────────────────────────────────────────────

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