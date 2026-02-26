import { createMailTransporter, getMailConfig } from '../config/mail';
import { Certificate, ICertificate } from '../models/Certificate';
import { NotificationSettings } from '../models/NotificationSettings';
import { logger } from '../utils/logger';

export interface CalendarSyncResult {
  success: boolean;
  icsCreated: number;
  graphCreated: number;
  skipped: number;
  errors: string[];
}

/**
 * Sync web certificate expirations to Teams calendar.
 * Supports ICS invites via SMTP and/or Microsoft Graph API.
 */
export async function syncCertificatesToCalendar(): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    success: true,
    icsCreated: 0,
    graphCreated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const settings = await NotificationSettings.findOne();
    if (!settings?.calendarConfig?.enabled) {
      logger.info('Calendar sync is disabled');
      return result;
    }

    const { method, icsTargetEmail, graphTenantId, graphClientId, graphClientSecret, graphCalendarEmail } = settings.calendarConfig;

    // Get excluded templates to only sync "real" web certs
    const excludedTemplates = settings.excludedTemplates || [];

    // Find active/expiring certificates, excluding auto-enroll templates
    const query: Record<string, any> = {
      status: { $in: ['active', 'expiring'] },
    };
    if (excludedTemplates.length > 0) {
      query.templateName = { $nin: excludedTemplates };
    }

    const certificates = await Certificate.find(query)
      .sort({ validTo: 1 })
      .populate('applicationId', 'name');

    if (certificates.length === 0) {
      logger.info('No certificates to sync to calendar');
      return result;
    }

    // ICS method
    if ((method === 'ics' || method === 'both') && icsTargetEmail) {
      for (const cert of certificates) {
        try {
          await sendICSEvent(cert, icsTargetEmail, settings);
          result.icsCreated++;
        } catch (err) {
          result.errors.push(`ICS failed for ${cert.commonName}: ${err}`);
        }
      }
    }

    // Graph API method
    if ((method === 'graph' || method === 'both') && graphTenantId && graphClientId && graphClientSecret && graphCalendarEmail) {
      try {
        const token = await getGraphToken(graphTenantId, graphClientId, graphClientSecret);
        for (const cert of certificates) {
          try {
            await createGraphCalendarEvent(token, graphCalendarEmail, cert);
            result.graphCreated++;
          } catch (err) {
            result.errors.push(`Graph failed for ${cert.commonName}: ${err}`);
          }
        }
      } catch (err) {
        result.errors.push(`Graph authentication failed: ${err}`);
        result.success = false;
      }
    }

    logger.info(`Calendar sync complete: ${result.icsCreated} ICS, ${result.graphCreated} Graph, ${result.errors.length} errors`);
  } catch (error) {
    result.success = false;
    result.errors.push(`Calendar sync error: ${error}`);
    logger.error('Calendar sync error:', error);
  }

  return result;
}

/**
 * Generate and send an ICS calendar invite via SMTP
 */
async function sendICSEvent(cert: ICertificate, targetEmail: string, settings: any): Promise<void> {
  const transporter = createMailTransporter();
  const config = getMailConfig();

  const expirationDate = new Date(cert.validTo);
  const uid = `certmgr-${cert.thumbprint}@certmanager`;

  // All-day event on the expiration date
  const startDate = formatICSDate(expirationDate);
  const endDate = formatICSDate(new Date(expirationDate.getTime() + 24 * 60 * 60 * 1000));
  const now = formatICSTimestamp(new Date());

  const appName = (cert as any).applicationId?.name || '';
  const summary = `Certificate Expiring: ${cert.commonName}${appName ? ` (${appName})` : ''}`;
  const description = [
    `Certificate: ${cert.commonName}`,
    `Serial: ${cert.serialNumber}`,
    `Thumbprint: ${cert.thumbprint}`,
    `Issuer: ${cert.issuer.commonName}`,
    `Template: ${cert.templateName || 'N/A'}`,
    appName ? `Application: ${appName}` : '',
    `Expires: ${expirationDate.toLocaleDateString()}`,
    '',
    'This certificate requires renewal before the expiration date.',
  ].filter(Boolean).join('\\n');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CertManager//Certificate Manager//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    `ORGANIZER:mailto:${config.from.match(/<(.+)>/)?.[1] || config.from}`,
    'BEGIN:VALARM',
    'TRIGGER:-P7D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Certificate expires in 7 days',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Certificate expires tomorrow',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  await transporter.sendMail({
    from: config.from,
    to: targetEmail,
    subject: summary,
    html: `<p>Calendar event created for certificate expiration: <strong>${escapeHtml(cert.commonName)}</strong> expiring ${escapeHtml(expirationDate.toLocaleDateString())}</p>`,
    alternatives: [{
      contentType: 'text/calendar; method=REQUEST',
      content: Buffer.from(icsContent),
    }],
  });
}

/**
 * Create a calendar event via Microsoft Graph API
 */
async function createGraphCalendarEvent(token: string, calendarEmail: string, cert: ICertificate): Promise<void> {
  const expirationDate = new Date(cert.validTo);
  const appName = (cert as any).applicationId?.name || '';

  const event = {
    subject: `Certificate Expiring: ${cert.commonName}${appName ? ` (${appName})` : ''}`,
    body: {
      contentType: 'HTML',
      content: `
        <p><strong>Certificate:</strong> ${escapeHtml(cert.commonName)}</p>
        <p><strong>Serial:</strong> ${escapeHtml(cert.serialNumber)}</p>
        <p><strong>Thumbprint:</strong> ${escapeHtml(cert.thumbprint)}</p>
        <p><strong>Issuer:</strong> ${escapeHtml(cert.issuer.commonName)}</p>
        <p><strong>Template:</strong> ${escapeHtml(cert.templateName || 'N/A')}</p>
        ${appName ? `<p><strong>Application:</strong> ${escapeHtml(appName)}</p>` : ''}
        <p>This certificate requires renewal before the expiration date.</p>
      `,
    },
    start: {
      dateTime: expirationDate.toISOString().split('T')[0] + 'T08:00:00',
      timeZone: 'Eastern Standard Time',
    },
    end: {
      dateTime: expirationDate.toISOString().split('T')[0] + 'T09:00:00',
      timeZone: 'Eastern Standard Time',
    },
    isAllDay: false,
    showAs: 'free',
    isReminderOn: true,
    reminderMinutesBeforeStart: 10080, // 7 days
    transactionId: `certmgr-${cert.thumbprint}`,
  };

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${calendarEmail}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Graph API error ${response.status}: ${error}`);
  }
}

/**
 * Get an OAuth2 token from Azure AD using client credentials
 */
async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token request failed ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Helpers
function formatICSDate(date: Date): string {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function formatICSTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}