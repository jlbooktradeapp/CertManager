import { Request, Response } from 'express';
import { Certificate } from '../models/Certificate';
import { getCertificateStats, updateCertificateStatuses, syncAllCAs } from '../services/certificateService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

// SEC-007: Sync concurrency lock — prevents parallel sync operations
let syncInProgress = false;
let lastSyncTriggeredAt = 0;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between manual syncs

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
      // Override status to exclude already expired/revoked/reissued
      if (!status) {
        query.status = { $nin: ['expired', 'revoked', 'reissued', 'rebound'] };
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

    // Load excluded templates from settings to match dashboard stats filtering
    const { NotificationSettings } = await import('../models/NotificationSettings');
    const settings = await NotificationSettings.findOne();
    const excludeTemplates = settings?.excludedTemplates || [];

    const query: Record<string, any> = {
      status: { $nin: ['expired', 'revoked', 'reissued', 'rebound'] },
      validTo: { $gte: now, $lte: futureDate },
    };

    if (excludeTemplates.length > 0) {
      query.templateName = { $nin: excludeTemplates };
    }

    const certificates = await Certificate.find(query)
      .sort({ validTo: 1 })
      .populate('issuer.caId', 'name displayName');

    res.json(certificates);
  } catch (error) {
    logger.error('Get expiring certificates error:', error);
    res.status(500).json({ error: 'Failed to get expiring certificates' });
  }
}

export async function getTemplateNames(req: Request, res: Response): Promise<void> {
  try {
    const { excludeHidden, includeRaw } = req.query;

    if (excludeHidden === 'true') {
      const { NotificationSettings } = await import('../models/NotificationSettings');
      const settings = await NotificationSettings.findOne();
      const excludeTemplates = settings?.excludedTemplates || [];

      const query: Record<string, any> = {};
      if (excludeTemplates.length > 0) {
        query.templateName = { $nin: excludeTemplates };
      }

      if (includeRaw === 'true') {
        // Return display name + CN name pairs for CSR submission
        // CN name is what certreq -attrib "CertificateTemplate:XXX" needs
        const certs = await Certificate.find(query)
          .select('templateName templateRawValue templateCN')
          .where('templateName').ne(null);
        
        // Build a deduplicated map: displayName → CN name (for certreq)
        const templatePairs = new Map<string, string>();
        for (const cert of certs) {
          if (cert.templateName && !templatePairs.has(cert.templateName)) {
            // Prefer templateCN (the AD CN name), fall back to templateRawValue, then templateName
            templatePairs.set(cert.templateName, cert.templateCN || cert.templateRawValue || cert.templateName);
          }
        }
        
        const result = Array.from(templatePairs.entries())
          .map(([displayName, rawValue]) => ({ displayName, rawValue }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        res.json(result);
      } else {
        const templates = await Certificate.distinct('templateName', query);
        res.json(templates.filter(Boolean).sort());
      }
    } else {
      const templates = await Certificate.distinct('templateName');
      res.json(templates.filter(Boolean).sort());
    }
  } catch (error) {
    logger.error('Get template names error:', error);
    res.status(500).json({ error: 'Failed to get template names' });
  }
}

export async function getOrganizationalUnits(_req: Request, res: Response): Promise<void> {
  try {
    // Respect excluded templates so OUs match the filtered certificate view
    const { NotificationSettings } = await import('../models/NotificationSettings');
    const settings = await NotificationSettings.findOne();
    const excludeTemplates = settings?.excludedTemplates || [];

    const query: Record<string, any> = {};
    if (excludeTemplates.length > 0) {
      query.templateName = { $nin: excludeTemplates };
    }

    const ous = await Certificate.distinct('subject.organizationalUnit', query);
    res.json(ous.filter(Boolean).sort());
  } catch (error) {
    logger.error('Get organizational units error:', error);
    res.status(500).json({ error: 'Failed to get organizational units' });
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
    // SEC-007: Prevent parallel syncs
    if (syncInProgress) {
      res.status(429).json({ error: 'Sync is already in progress. Please wait for it to complete.' });
      return;
    }

    // SEC-007: Rate limit manual sync triggers (5 min cooldown)
    const now = Date.now();
    if (now - lastSyncTriggeredAt < SYNC_COOLDOWN_MS) {
      const waitSec = Math.ceil((SYNC_COOLDOWN_MS - (now - lastSyncTriggeredAt)) / 1000);
      res.status(429).json({ error: `Sync was recently triggered. Please wait ${waitSec} seconds before trying again.` });
      return;
    }

    logger.info(`Manual sync triggered by ${req.user?.username}`);
    syncInProgress = true;
    lastSyncTriggeredAt = now;

    // Run sync in background
    syncAllCAs()
      .catch(err => {
        logger.error('Background sync error:', err);
      })
      .finally(() => {
        syncInProgress = false;
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
    const { notificationRecipients, applicationId, status, serverType, autoRenew } = req.body;

    const updates: Record<string, unknown> = {};

    // Allow manual status override
    if (status !== undefined) {
      const allowedManualStatuses = ['reissued', 'rebound'];
      if (!allowedManualStatuses.includes(status)) {
        res.status(400).json({ error: `Status can only be manually set to: ${allowedManualStatuses.join(', ')}` });
        return;
      }
      updates.status = status;
    }

    // Allow editing serverType (required for re-issue and auto-renewal)
    if (serverType !== undefined) {
      if (serverType !== null && serverType !== 'apache' && serverType !== 'iis') {
        res.status(400).json({ error: 'serverType must be "apache", "iis", or null' });
        return;
      }
      updates.serverType = serverType;
    }

    // Allow editing auto-renewal configuration
    if (autoRenew !== undefined) {
      if (typeof autoRenew !== 'object' || autoRenew === null) {
        res.status(400).json({ error: 'autoRenew must be an object' });
        return;
      }
      // Validate daysBeforeExpiry range
      if (autoRenew.daysBeforeExpiry !== undefined) {
        const days = Number(autoRenew.daysBeforeExpiry);
        if (isNaN(days) || days < 7 || days > 90) {
          res.status(400).json({ error: 'autoRenew.daysBeforeExpiry must be between 7 and 90' });
          return;
        }
      }
      // Can only enable auto-renewal when serverType is set
      if (autoRenew.enabled) {
        const cert = await Certificate.findById(id);
        const effectiveServerType = serverType !== undefined ? serverType : cert?.serverType;
        if (!effectiveServerType) {
          res.status(400).json({ error: 'Cannot enable auto-renewal without a serverType set' });
          return;
        }
      }
      updates.autoRenew = autoRenew;
    }

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