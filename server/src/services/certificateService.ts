import { Certificate, ICertificate } from '../models/Certificate';
import { CertificateAuthority, ICertificateAuthority } from '../models/CertificateAuthority';
import { getCAIssuedCertificates } from './powershellService';
import { logger } from '../utils/logger';

export interface CertificateStats {
  total: number;
  active: number;
  expiring: number;
  expired: number;
  revoked: number;
  reissued: number;
  rebound: number;
  expiringIn30Days: number;
  expiringIn7Days: number;
}

export async function getCertificateStats(excludeTemplates?: string[]): Promise<CertificateStats> {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Base filter to exclude hidden templates
  const base: Record<string, any> = {};
  if (excludeTemplates && excludeTemplates.length > 0) {
    base.templateName = { $nin: excludeTemplates };
  }

  const [
    total,
    active,
    expiring,
    expired,
    revoked,
    reissued,
    rebound,
    expiringIn30Days,
    expiringIn7Days,
  ] = await Promise.all([
    Certificate.countDocuments({ ...base }),
    Certificate.countDocuments({ ...base, status: 'active' }),
    Certificate.countDocuments({ ...base, status: 'expiring' }),
    Certificate.countDocuments({ ...base, status: 'expired' }),
    Certificate.countDocuments({ ...base, status: 'revoked' }),
    Certificate.countDocuments({ ...base, status: 'reissued' }),
    Certificate.countDocuments({ ...base, status: 'rebound' }),
    Certificate.countDocuments({
      ...base,
      status: { $nin: ['expired', 'revoked', 'reissued', 'rebound'] },
      validTo: { $gte: now, $lte: in30Days },
    }),
    Certificate.countDocuments({
      ...base,
      status: { $nin: ['expired', 'revoked', 'reissued', 'rebound'] },
      validTo: { $gte: now, $lte: in7Days },
    }),
  ]);

  return {
    total,
    active,
    expiring,
    expired,
    revoked,
    reissued,
    rebound,
    expiringIn30Days,
    expiringIn7Days,
  };
}

export async function updateCertificateStatuses(): Promise<number> {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Mark expired certificates (but don't override 'reissued' or 'revoked')
  const expiredResult = await Certificate.updateMany(
    {
      status: { $nin: ['expired', 'revoked', 'reissued', 'rebound'] },
      validTo: { $lt: now },
    },
    { $set: { status: 'expired' } }
  );

  // Mark expiring certificates (within 30 days)
  const expiringResult = await Certificate.updateMany(
    {
      status: 'active',
      validTo: { $gte: now, $lte: in30Days },
    },
    { $set: { status: 'expiring' } }
  );

  // Mark active certificates (not expiring within 30 days)
  const activeResult = await Certificate.updateMany(
    {
      status: 'expiring',
      validTo: { $gt: in30Days },
    },
    { $set: { status: 'active' } }
  );

  // Update reissued certs that have expired to 'reissued' (keep reissued, don't flip to expired)
  // This ensures reissued stays as reissued even after expiration
  // No action needed — reissued status is preserved by the $nin above

  const totalUpdated =
    (expiredResult.modifiedCount || 0) +
    (expiringResult.modifiedCount || 0) +
    (activeResult.modifiedCount || 0);

  if (totalUpdated > 0) {
    logger.info(`Updated ${totalUpdated} certificate statuses`);
  }

  return totalUpdated;
}

/**
 * Detect reissued certificates by grouping on commonName + SANs.
 * Within each group, the cert with the latest validTo is the "current" one.
 * All older certs are marked as 'reissued'.
 */
export async function detectReissuedCertificates(): Promise<number> {
  let markedCount = 0;

  // Aggregation: group by commonName + sorted SANs, find groups with 2+ certs
  const groups = await Certificate.aggregate([
    // Only consider non-revoked certs
    { $match: { status: { $ne: 'revoked' } } },
    // Sort SANs for consistent grouping
    {
      $addFields: {
        sanKey: {
          $cond: {
            if: { $gt: [{ $size: { $ifNull: ['$subjectAlternativeNames', []] } }, 0] },
            then: {
              $reduce: {
                input: { $sortArray: { input: { $ifNull: ['$subjectAlternativeNames', []] }, sortBy: 1 } },
                initialValue: '',
                in: { $concat: ['$$value', '|', '$$this'] },
              },
            },
            else: '',
          },
        },
      },
    },
    // Group by CN + SAN key
    {
      $group: {
        _id: { cn: '$commonName', sans: '$sanKey' },
        certs: {
          $push: {
            _id: '$_id',
            validTo: '$validTo',
            status: '$status',
          },
        },
        count: { $sum: 1 },
      },
    },
    // Only groups with duplicates
    { $match: { count: { $gt: 1 } } },
  ]);

  for (const group of groups) {
    // Sort by validTo descending — newest first
    const sorted = group.certs.sort(
      (a: any, b: any) => new Date(b.validTo).getTime() - new Date(a.validTo).getTime()
    );

    // The first one (newest validTo) is the current cert — skip it
    // All others are reissued
    const reissuedIds = sorted
      .slice(1)
      .filter((c: any) => c.status !== 'reissued' && c.status !== 'rebound')
      .map((c: any) => c._id);

    if (reissuedIds.length > 0) {
      const result = await Certificate.updateMany(
        { _id: { $in: reissuedIds } },
        { $set: { status: 'reissued' } }
      );
      markedCount += result.modifiedCount || 0;
    }
  }

  if (markedCount > 0) {
    logger.info(`Marked ${markedCount} certificates as reissued`);
  }

  return markedCount;
}

// Track CAs currently being synced to prevent concurrent syncs
const activeSyncs = new Set<string>();

export async function syncAllCAs(): Promise<void> {
  const cas = await CertificateAuthority.find({ syncEnabled: true });

  for (const ca of cas) {
    try {
      await syncCA(ca);
    } catch (error) {
      logger.error(`Failed to sync CA ${ca.name}:`, error);
    }
  }

  // Update all certificate statuses after sync
  await updateCertificateStatuses();

  // Detect reissued certificates (same CN + SANs)
  await detectReissuedCertificates();
}

// Replace the syncCA function (around line 114) in certificateService.ts with this:

// Replace the syncCA function in certificateService.ts with this:
// Also update the import at the top:
//   import { getCAIssuedCertificates, SyncResult } from './powershellService';

export async function syncCA(ca: ICertificateAuthority): Promise<number> {
  const caKey = ca._id.toString();

  // Prevent concurrent syncs on the same CA
  if (activeSyncs.has(caKey)) {
    logger.warn(`Sync already in progress for ${ca.name}, skipping`);
    return 0;
  }

  activeSyncs.add(caKey);

  try {
    logger.info(`Syncing certificates from CA: ${ca.name}`);

    let result;

    if (ca.lastRequestID && ca.lastRequestID > 0) {
      // Incremental sync using RequestID watermark — only pulls newly issued certs
      logger.info(`Incremental sync for ${ca.name} (RequestID > ${ca.lastRequestID})`);
      result = await getCAIssuedCertificates(ca.configString, {
        startRequestID: ca.lastRequestID,
      });
    } else if (ca.lastSyncedAt) {
      // Legacy fallback: CA was synced before but doesn't have a RequestID watermark
      // Use SinceDate for this one sync, then switch to RequestID going forward
      const sinceDate = ca.lastSyncedAt.toLocaleDateString('en-US');
      logger.info(`Legacy incremental sync for ${ca.name} since ${sinceDate} (will switch to RequestID after)`);
      result = await getCAIssuedCertificates(ca.configString, {
        sinceDate,
      });
    } else {
      // First-time sync — pull certs within the expiration window (default 2 years)
      logger.info(`Full sync for ${ca.name} (first time, 2-year window)`);
      result = await getCAIssuedCertificates(ca.configString, {
        maxExpirationYears: 2,
      });
    }

    if (!result.success) {
      throw new Error(`Failed to get certificates from CA: ${result.error}`);
    }

    let certificates: any[];
    try {
      certificates = JSON.parse(result.output);
      if (!Array.isArray(certificates)) {
        certificates = [certificates];
      }
    } catch {
      logger.error('Failed to parse CA output:', result.output?.substring(0, 200));
      throw new Error('Failed to parse certificate data from CA');
    }

    logger.info(`Processing ${certificates.length} certificates from ${ca.name}`);

    // SYNC-DIAG: log raw fields for every cert returned by PowerShell
    for (let i = 0; i < certificates.length; i++) {
      const c = certificates[i];
      logger.info(
        `[SYNC-DIAG] [${i + 1}/${certificates.length}] ` +
        `RequestID=${c.RequestID ?? 'NULL'} | ` +
        `SerialNumber=${c.SerialNumber ?? 'NULL'} | ` +
        `Thumbprint=${c.Thumbprint ?? 'NULL'} | ` +
        `CommonName=${c.CommonName ?? 'NULL'} | ` +
        `NotBefore=${c.NotBefore ?? 'NULL'} | ` +
        `NotAfter=${c.NotAfter ?? 'NULL'}`
      );
    }

    let syncedCount = 0;

    for (const certData of certificates) {
      // SYNC-DIAG: warn loudly if SerialNumber is missing — upsert will match wrong records
      if (!certData.SerialNumber) {
        logger.error(`[SYNC-DIAG] SerialNumber is NULL/empty for CN=${certData.CommonName} RequestID=${certData.RequestID} — skipping to avoid corrupting existing records`);
        continue;
      }

      try {
        const upsertResult = await Certificate.findOneAndUpdate(
          { serialNumber: certData.SerialNumber },
          {
            $set: {
              serialNumber: certData.SerialNumber,
              thumbprint: certData.Thumbprint || '',
              commonName: certData.CommonName || extractCN(certData.Subject),
              subjectAlternativeNames: certData.SANs || [],
              issuer: {
                caId: ca._id,
                commonName: ca.displayName,
              },
              subject: parseSubject(certData.Subject),
              validFrom: new Date(certData.NotBefore),
              validTo: new Date(certData.NotAfter),
              keyUsage: certData.KeyUsage || [],
              extendedKeyUsage: certData.ExtendedKeyUsage || [],
              templateName: certData.Template,
              templateRawValue: certData.TemplateRaw || certData.Template,
              templateCN: certData.TemplateCN || certData.Template,
              keySize: certData.KeySize || undefined,
              encryptionType: certData.EncryptionType || undefined,
              'metadata.lastSyncedAt': new Date(),
            },
            $setOnInsert: {
              status: 'active',
              deployedTo: [],
              notificationsSent: [],
              'metadata.discoveredAt': new Date(),
            },
          },
          { upsert: true, new: true }
        );

        // SYNC-DIAG: log whether this was an insert or an update, and what _id was affected
        const wasInsert = upsertResult && upsertResult.metadata?.discoveredAt &&
          Math.abs(new Date(upsertResult.metadata.discoveredAt).getTime() - Date.now()) < 5000;
        logger.info(
          `[SYNC-DIAG] Upsert done — Serial=${certData.SerialNumber} | ` +
          `CN=${certData.CommonName} | ` +
          `_id=${upsertResult?._id} | ` +
          `DB commonName=${upsertResult?.commonName} | ` +
          `discoveredAt=${upsertResult?.metadata?.discoveredAt}`
        );

        syncedCount++;
      } catch (error: any) {
        logger.error(
          `[SYNC-DIAG] Upsert FAILED — Serial=${certData.SerialNumber} | CN=${certData.CommonName} | Error: ${error?.message || error}`,
          error
        );
      }
    }

    // Update CA: lastSyncedAt and lastRequestID watermark.
    //
    // SAFETY BUFFER: The CA's ICertView COM interface can lag slightly — a cert
    // issued seconds before a sync query may not yet be visible, causing the
    // watermark to advance past it permanently. To prevent this, we hold the
    // watermark 20 RequestIDs behind the highest seen. Each sync therefore
    // re-processes the last 20 IDs from the previous run. Since the upsert is
    // idempotent (match on serialNumber), re-processing existing certs is harmless.
    const WATERMARK_SAFETY_BUFFER = 20;
    ca.lastSyncedAt = new Date();
    if (result.lastRequestID && result.lastRequestID > (ca.lastRequestID || 0)) {
      const bufferedWatermark = Math.max(
        ca.lastRequestID || 0,
        result.lastRequestID - WATERMARK_SAFETY_BUFFER
      );
      ca.lastRequestID = bufferedWatermark;
      logger.info(
        `Updated ${ca.name} RequestID watermark to ${bufferedWatermark} ` +
        `(raw lastID: ${result.lastRequestID}, buffer: ${WATERMARK_SAFETY_BUFFER})`
      );
    }
    await ca.save();

    logger.info(`Synced ${syncedCount} certificates from CA: ${ca.name}`);
    return syncedCount;

  } finally {
    activeSyncs.delete(caKey);
  }
}

function extractCN(subject: string): string {
  const match = subject?.match(/CN=([^,]+)/i);
  return match ? match[1] : subject || 'Unknown';
}

function parseSubject(subject: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!subject) return result;

  const parts = subject.split(',').map(p => p.trim());

  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=');

    switch (key.toUpperCase()) {
      case 'CN':
        result.commonName = value;
        break;
      case 'O':
        result.organization = value;
        break;
      case 'OU':
        result.organizationalUnit = value;
        break;
      case 'L':
        result.locality = value;
        break;
      case 'S':
      case 'ST':
        result.state = value;
        break;
      case 'C':
        result.country = value;
        break;
    }
  }

  return result;
}

export async function getExpiringCertificates(days: number = 30): Promise<ICertificate[]> {
  const now = new Date();
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return Certificate.find({
    status: { $nin: ['expired', 'revoked', 'reissued', 'rebound'] },
    validTo: { $gte: now, $lte: futureDate },
  })
    .sort({ validTo: 1 })
    .populate('issuer.caId', 'name displayName');
}