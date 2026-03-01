import { Certificate, ICertificate } from '../models/Certificate';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { NotificationSettings } from '../models/NotificationSettings';
import { revokeCertificate } from './powershellService';
import { createMailTransporter, getMailConfig } from '../config/mail';
import { logger } from '../utils/logger';

export interface CleanupStats {
  eligible: number;
  retentionDays: number;
}

export interface CleanupResult {
  total: number;
  revoked: number;
  deleted: number;
  failed: number;
  errors: { serialNumber: string; commonName: string; error: string }[];
}

/**
 * Get certificates eligible for cleanup based on retention policy.
 * Two categories:
 *   1. Expired certs where validTo is older than retentionDays ago
 *   2. Reissued certs where validTo has passed (no retention wait — already superseded)
 */
export async function getEligibleCertificates(
  retentionDays?: number,
  page: number = 1,
  limit: number = 25,
  search?: string
): Promise<{ data: ICertificate[]; total: number; retentionDays: number }> {
  const settings = await NotificationSettings.findOne();
  const days = retentionDays ?? settings?.cleanupConfig?.retentionDays ?? 90;
  const excludedTemplates = settings?.excludedTemplates || [];

  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Base template exclusion
  const templateFilter: Record<string, any> = {};
  if (excludedTemplates.length > 0) {
    templateFilter.templateName = { $nin: excludedTemplates };
  }

  // Two-pronged eligibility: expired past retention OR reissued past expiration
  const query: Record<string, any> = {
    ...templateFilter,
    $or: [
      // Regular expired: validTo older than retention cutoff (date-based, not just status)
      { validTo: { $lt: cutoffDate }, status: { $in: ['expired'] } },
      // Also catch expired certs whose status wasn't updated yet (resilience)
      { validTo: { $lt: cutoffDate }, status: { $nin: ['revoked', 'reissued', 'rebound'] } },
      // Reissued: eligible as soon as they've expired (no retention wait)
      { validTo: { $lt: now }, status: { $in: ['reissued', 'rebound'] } },
    ],
  };

  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    query.$and = [
      {
        $or: [
          { commonName: searchRegex },
          { serialNumber: searchRegex },
          { templateName: searchRegex },
        ],
      },
    ];
    // Move the existing $or into $and to combine with search
    const eligibilityOr = query.$or;
    delete query.$or;
    query.$and = [
      { $or: eligibilityOr },
      {
        $or: [
          { commonName: searchRegex },
          { serialNumber: searchRegex },
          { templateName: searchRegex },
        ],
      },
    ];
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    Certificate.find(query)
      .sort({ validTo: 1 })
      .skip(skip)
      .limit(limit)
      .populate('issuer.caId', 'name displayName hostname configString'),
    Certificate.countDocuments(query),
  ]);

  return { data, total, retentionDays: days };
}

/**
 * Get count of eligible certificates for cleanup stats / digest.
 */
export async function getCleanupStats(): Promise<CleanupStats> {
  const settings = await NotificationSettings.findOne();
  const days = settings?.cleanupConfig?.retentionDays ?? 90;
  const excludedTemplates = settings?.excludedTemplates || [];

  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const templateFilter: Record<string, any> = {};
  if (excludedTemplates.length > 0) {
    templateFilter.templateName = { $nin: excludedTemplates };
  }

  const eligible = await Certificate.countDocuments({
    ...templateFilter,
    $or: [
      { validTo: { $lt: cutoffDate }, status: { $in: ['expired'] } },
      { validTo: { $lt: cutoffDate }, status: { $nin: ['revoked', 'reissued', 'rebound'] } },
      { validTo: { $lt: now }, status: { $in: ['reissued', 'rebound'] } },
    ],
  });

  return { eligible, retentionDays: days };
}

/**
 * Revoke certificates on their CA and delete from the database.
 */
export async function revokeAndDeleteCertificates(certIds: string[]): Promise<CleanupResult> {
  const result: CleanupResult = {
    total: certIds.length,
    revoked: 0,
    deleted: 0,
    failed: 0,
    errors: [],
  };

  // Load all certs with their CA info
  const certificates = await Certificate.find({ _id: { $in: certIds } })
    .populate('issuer.caId', 'configString name');

  for (const cert of certificates) {
    try {
      // Get the CA config string for revocation
      const ca = cert.issuer?.caId as any;
      const configString = ca?.configString;

      if (configString && cert.serialNumber) {
        // Attempt to revoke on the CA
        const revokeResult = await revokeCertificate(configString, cert.serialNumber);

        if (revokeResult.success) {
          let parsed;
          try {
            parsed = JSON.parse(revokeResult.output);
          } catch {
            parsed = { Success: true };
          }

          if (parsed.Success) {
            result.revoked++;
          } else {
            // Revocation failed but we still want to track it
            logger.warn(`Revocation returned failure for ${cert.commonName}: ${parsed.Message}`);
          }
        } else {
          // Log but don't block deletion - cert is already expired
          logger.warn(`Could not revoke ${cert.commonName} on CA: ${revokeResult.error}`);
        }
      }

      // Delete from database regardless (cert is expired anyway)
      await cert.deleteOne();
      result.deleted++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        serialNumber: cert.serialNumber,
        commonName: cert.commonName,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(`Cleanup failed for ${cert.commonName}:`, error);
    }
  }

  logger.info(`Cleanup complete: ${result.revoked} revoked, ${result.deleted} deleted, ${result.failed} failed`);
  return result;
}

/**
 * Send cleanup digest email to notify admins of eligible certificates.
 */
export async function sendCleanupDigest(): Promise<boolean> {
  try {
    const settings = await NotificationSettings.findOne();

    if (!settings?.cleanupConfig?.digestEnabled || !settings.enabled) {
      return false;
    }

    const stats = await getCleanupStats();

    if (stats.eligible === 0) {
      logger.info('Cleanup digest: no eligible certificates, skipping');
      return false;
    }

    // Get recipients (reuse notification recipients)
    const recipients: string[] = [];
    for (const r of settings.recipients) {
      if (r.type === 'email') {
        recipients.push(r.value);
      }
    }

    if (recipients.length === 0) {
      logger.warn('Cleanup digest: no recipients configured');
      return false;
    }

    // Get a sample of the oldest eligible certs for the email
    const { data: sampleCerts } = await getEligibleCertificates(undefined, 1, 10);

    const transporter = createMailTransporter();
    const config = getMailConfig();

    const certRows = sampleCerts.map(cert => {
      const expiredDate = new Date(cert.validTo).toLocaleDateString();
      const daysExpired = Math.floor((Date.now() - new Date(cert.validTo).getTime()) / (1000 * 60 * 60 * 24));
      return `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.commonName)}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(cert.templateName || 'N/A')}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${expiredDate}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${daysExpired} days ago</td>
        </tr>
      `;
    }).join('');

    const moreText = stats.eligible > 10
      ? `<p>Showing 10 of ${stats.eligible} certificates. View all in Certificate Manager.</p>`
      : '';

    const html = `
      <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #f57c00;">Certificate Cleanup Digest</h2>
        <p>
          There are <strong>${stats.eligible}</strong> expired certificates that have been expired
          for more than <strong>${stats.retentionDays} days</strong> and are eligible for cleanup.
        </p>
        <p>Please review and clean up these certificates in Certificate Manager.</p>

        <table style="border-collapse: collapse; width: 100%; max-width: 800px; margin-top: 16px;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Common Name</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Template</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Expired</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Age</th>
            </tr>
          </thead>
          <tbody>
            ${certRows}
          </tbody>
        </table>
        ${moreText}

        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated digest from Certificate Manager.
          Configure cleanup settings in Settings &gt; Certificate Cleanup.
        </p>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: config.from,
      to: recipients.join(', '),
      subject: `[Certificate Manager] ${stats.eligible} Certificates Eligible for Cleanup`,
      html,
    });

    // Update last digest sent timestamp
    settings.cleanupConfig.lastDigestSent = new Date();
    await settings.save();

    logger.info(`Cleanup digest sent: ${stats.eligible} eligible certs, notified ${recipients.length} recipients`);
    return true;
  } catch (error) {
    logger.error('Failed to send cleanup digest:', error);
    return false;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}