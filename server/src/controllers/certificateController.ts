import { Request, Response } from 'express';
import { Certificate } from '../models/Certificate';
import { getCertificateStats, updateCertificateStatuses, syncAllCAs } from '../services/certificateService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function listCertificates(req: Request, res: Response): Promise<void> {
  try {
    const {
      page = '1',
      limit = '25',
      status,
      search,
      sortBy = 'validTo',
      sortOrder = 'asc',
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query: Record<string, any> = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      query.$or = [
        { commonName: searchRegex },
        { serialNumber: searchRegex },
        { thumbprint: searchRegex },
        { subjectAlternativeNames: searchRegex },
      ];
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {};
    sort[sortBy as string] = sortOrder === 'desc' ? -1 : 1;

    const [certificates, total] = await Promise.all([
      Certificate.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate('issuer.caId', 'name displayName'),
      Certificate.countDocuments(query),
    ]);

    res.json({
      data: certificates,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('List certificates error:', error);
    res.status(500).json({ error: 'Failed to list certificates' });
  }
}

export async function getCertificate(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const certificate = await Certificate.findById(id)
      .populate('issuer.caId', 'name displayName hostname')
      .populate('deployedTo.serverId', 'hostname fqdn');

    if (!certificate) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    res.json(certificate);
  } catch (error) {
    logger.error('Get certificate error:', error);
    res.status(500).json({ error: 'Failed to get certificate' });
  }
}

export async function getExpiringCertificates(req: Request, res: Response): Promise<void> {
  try {
    const { days = '30' } = req.query;
    const daysNum = parseInt(days as string, 10);

    const now = new Date();
    const futureDate = new Date(now.getTime() + daysNum * 24 * 60 * 60 * 1000);

    const certificates = await Certificate.find({
      status: { $nin: ['expired', 'revoked'] },
      validTo: { $gte: now, $lte: futureDate },
    })
      .sort({ validTo: 1 })
      .populate('issuer.caId', 'name displayName');

    res.json(certificates);
  } catch (error) {
    logger.error('Get expiring certificates error:', error);
    res.status(500).json({ error: 'Failed to get expiring certificates' });
  }
}

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const stats = await getCertificateStats();
    res.json(stats);
  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get certificate statistics' });
  }
}

export async function triggerSync(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    logger.info(`Manual sync triggered by ${req.user?.username}`);

    // Run sync in background
    syncAllCAs().catch(err => {
      logger.error('Background sync error:', err);
    });

    res.json({ message: 'Sync started' });
  } catch (error) {
    logger.error('Trigger sync error:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
}

export async function deleteCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const certificate = await Certificate.findById(id);

    if (!certificate) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    await certificate.deleteOne();

    logger.info(`Certificate ${certificate.commonName} deleted by ${req.user?.username}`);

    res.json({ message: 'Certificate removed from tracking' });
  } catch (error) {
    logger.error('Delete certificate error:', error);
    res.status(500).json({ error: 'Failed to delete certificate' });
  }
}
