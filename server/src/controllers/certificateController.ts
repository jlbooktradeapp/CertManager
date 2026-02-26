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
      maxDays,
      excludeTemplates,
      templateName,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query: Record<string, any> = {};

    if (status) {
      query.status = status;
    }

    // Filter by max days until expiration (e.g., maxDays=7 for critical)
    if (maxDays) {
      const days = parseInt(maxDays as string, 10);
      const now = new Date();
      const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      query.validTo = { $gte: now, $lte: futureDate };
      // Override status to exclude already expired/revoked
      if (!status) {
        query.status = { $nin: ['expired', 'revoked'] };
      }
    }

    // Template filtering
    if (templateName) {
      query.templateName = templateName;
    } else if (excludeTemplates) {
      const templates = (excludeTemplates as string).split(',').map(t => t.trim());
      query.templateName = { $nin: templates };
    }

    if (search) {
      // Escape regex special characters to prevent ReDoS
      const escapedSearch = (search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
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
      .populate('deployedTo.serverId', 'hostname fqdn')
      .populate('applicationId', 'name description owners vendor status');

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

export async function getTemplateNames(_req: Request, res: Response): Promise<void> {
  try {
    const templates = await Certificate.distinct('templateName');
    res.json(templates.filter(Boolean).sort());
  } catch (error) {
    logger.error('Get template names error:', error);
    res.status(500).json({ error: 'Failed to get template names' });
  }
}

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    // Load excluded templates from settings so dashboard counts match the filtered view
    const { NotificationSettings } = await import('../models/NotificationSettings');
    const settings = await NotificationSettings.findOne();
    const excludeTemplates = settings?.excludedTemplates || [];

    const stats = await getCertificateStats(excludeTemplates);
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

export async function updateCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { notificationRecipients, applicationId } = req.body;

    const updates: Record<string, unknown> = {};

    if (notificationRecipients !== undefined) {
      if (!Array.isArray(notificationRecipients)) {
        res.status(400).json({ error: 'notificationRecipients must be an array of email addresses' });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalid = notificationRecipients.filter((e: string) => !emailRegex.test(e));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Invalid email address(es): ${invalid.join(', ')}` });
        return;
      }
      updates.notificationRecipients = notificationRecipients;
    }

    if (applicationId !== undefined) {
      if (applicationId === null) {
        updates.applicationId = null;
      } else {
        const { Application } = await import('../models/Application');
        const app = await Application.findById(applicationId);
        if (!app) {
          res.status(400).json({ error: 'Application not found' });
          return;
        }
        updates.applicationId = applicationId;
      }
    }

    const certificate = await Certificate.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('applicationId', 'name description owners vendor status');

    if (!certificate) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    logger.info(`Certificate ${certificate.commonName} updated by ${req.user?.username}`);

    res.json(certificate);
  } catch (error) {
    logger.error('Update certificate error:', error);
    res.status(500).json({ error: 'Failed to update certificate' });
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