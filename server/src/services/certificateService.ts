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
  expiringIn30Days: number;
  expiringIn7Days: number;
}

export async function getCertificateStats(): Promise<CertificateStats> {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    total,
    active,
    expiring,
    expired,
    revoked,
    expiringIn30Days,
    expiringIn7Days,
  ] = await Promise.all([
    Certificate.countDocuments(),
    Certificate.countDocuments({ status: 'active' }),
    Certificate.countDocuments({ status: 'expiring' }),
    Certificate.countDocuments({ status: 'expired' }),
    Certificate.countDocuments({ status: 'revoked' }),
    Certificate.countDocuments({
      status: { $nin: ['expired', 'revoked'] },
      validTo: { $gte: now, $lte: in30Days },
    }),
    Certificate.countDocuments({
      status: { $nin: ['expired', 'revoked'] },
      validTo: { $gte: now, $lte: in7Days },
    }),
  ]);

  return {
    total,
    active,
    expiring,
    expired,
    revoked,
    expiringIn30Days,
    expiringIn7Days,
  };
}

export async function updateCertificateStatuses(): Promise<number> {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Mark expired certificates
  const expiredResult = await Certificate.updateMany(
    {
      status: { $nin: ['expired', 'revoked'] },
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

  const totalUpdated =
    (expiredResult.modifiedCount || 0) +
    (expiringResult.modifiedCount || 0) +
    (activeResult.modifiedCount || 0);

  if (totalUpdated > 0) {
    logger.info(`Updated ${totalUpdated} certificate statuses`);
  }

  return totalUpdated;
}

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
}

export async function syncCA(ca: ICertificateAuthority): Promise<number> {
  logger.info(`Syncing certificates from CA: ${ca.name}`);

  const result = await getCAIssuedCertificates(ca.configString);

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
    logger.error('Failed to parse CA output:', result.output);
    throw new Error('Failed to parse certificate data from CA');
  }

  let syncedCount = 0;

  for (const certData of certificates) {
    try {
      await Certificate.findOneAndUpdate(
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
            templateName: certData.Template,
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
      syncedCount++;
    } catch (error) {
      logger.error(`Failed to sync certificate ${certData.SerialNumber}:`, error);
    }
  }

  // Update CA last synced time
  ca.lastSyncedAt = new Date();
  await ca.save();

  logger.info(`Synced ${syncedCount} certificates from CA: ${ca.name}`);
  return syncedCount;
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
    status: { $nin: ['expired', 'revoked'] },
    validTo: { $gte: now, $lte: futureDate },
  })
    .sort({ validTo: 1 })
    .populate('issuer.caId', 'name displayName');
}
