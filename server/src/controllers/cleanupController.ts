import { Request, Response } from 'express';
import { getEligibleCertificates, getCleanupStats, revokeAndDeleteCertificates, sendCleanupDigest } from '../services/cleanupService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function getEligible(req: Request, res: Response): Promise<void> {
  try {
    const {
      page = '1',
      limit = '25',
      search,
      retentionDays,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const days = retentionDays ? parseInt(retentionDays as string, 10) : undefined;

    const result = await getEligibleCertificates(days, pageNum, limitNum, search as string);

    res.json({
      data: result.data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        pages: Math.ceil(result.total / limitNum),
      },
      retentionDays: result.retentionDays,
    });
  } catch (error) {
    logger.error('Get eligible certificates error:', error);
    res.status(500).json({ error: 'Failed to get eligible certificates' });
  }
}

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const stats = await getCleanupStats();
    res.json(stats);
  } catch (error) {
    logger.error('Get cleanup stats error:', error);
    res.status(500).json({ error: 'Failed to get cleanup stats' });
  }
}

export async function revokeAndDelete(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { certIds } = req.body;

    if (!Array.isArray(certIds) || certIds.length === 0) {
      res.status(400).json({ error: 'certIds must be a non-empty array' });
      return;
    }

    if (certIds.length > 100) {
      res.status(400).json({ error: 'Maximum 100 certificates per batch' });
      return;
    }

    logger.info(`Cleanup initiated by ${req.user?.username}: ${certIds.length} certificates`);

    const result = await revokeAndDeleteCertificates(certIds);

    logger.info(`Cleanup completed by ${req.user?.username}: ${result.deleted} deleted, ${result.revoked} revoked, ${result.failed} failed`);

    res.json(result);
  } catch (error) {
    logger.error('Revoke and delete error:', error);
    res.status(500).json({ error: 'Failed to process cleanup' });
  }
}

export async function triggerDigest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    logger.info(`Cleanup digest manually triggered by ${req.user?.username}`);
    const sent = await sendCleanupDigest();

    if (sent) {
      res.json({ message: 'Cleanup digest sent successfully' });
    } else {
      res.json({ message: 'No digest sent (no eligible certificates or digest disabled)' });
    }
  } catch (error) {
    logger.error('Trigger cleanup digest error:', error);
    res.status(500).json({ error: 'Failed to send cleanup digest' });
  }
}