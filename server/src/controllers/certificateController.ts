import { Request, Response } from 'express';
import { Certificate } from '../models/Certificate';
import { CSRRequest } from '../models/CSRRequest';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { getCertificateStats, updateCertificateStatuses, syncAllCAs } from '../services/certificateService';
import { runAutoRenewalForCert } from '../services/autoRenewalService';
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

/**
 * POST /api/certificates/:id/reissue
 *
 * Creates a pre-populated CSR draft copied from an existing certificate's attributes.
 * Returns the new CSRRequest ID so the frontend can navigate directly into the CSR wizard
 * (generate → submit → deliver/install) — the operator can review and adjust before proceeding.
 *
 * Accepts optional overrides in the request body:
 *   serverType     — 'apache' | 'iis'  (defaults to cert.serverType, then 'apache')
 *   targetCAId     — override which CA to submit to (defaults to the issuing CA if issuance-enabled)
 *   targetServerId — IIS only: which server to install on
 *   deliveryEmails — Apache only: who receives the cert+key zip
 */
export async function reissueCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const cert = await Certificate.findById(id).populate('issuer.caId');
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    if (cert.status === 'revoked') {
      res.status(400).json({ error: 'Cannot re-issue a revoked certificate' });
      return;
    }

    const {
      serverType = cert.serverType || 'apache',
      targetCAId,
      targetServerId,
      deliveryEmails = [],
    } = req.body;

    if (!['apache', 'iis'].includes(serverType)) {
      res.status(400).json({ error: 'serverType must be "apache" or "iis"' });
      return;
    }

    // Resolve which CA to use — prefer body override, fall back to original issuer
    let resolvedCAId = targetCAId || null;
    if (!resolvedCAId && cert.issuer?.caId) {
      const issuingCA = await CertificateAuthority.findById(cert.issuer.caId);
      if (issuingCA?.issuanceEnabled) {
        resolvedCAId = issuingCA._id;
      }
    }

    // If a CA was explicitly specified, validate it
    if (targetCAId) {
      const ca = await CertificateAuthority.findById(targetCAId);
      if (!ca) {
        res.status(400).json({ error: 'Certificate authority not found' });
        return;
      }
      if (!ca.issuanceEnabled) {
        res.status(400).json({ error: `CA "${ca.name}" is not enabled for certificate issuance` });
        return;
      }
    }

    const workflowSteps = serverType === 'apache'
      ? [
          { step: 'Generate CSR',       status: 'pending' as const },
          { step: 'Submit to CA',        status: 'pending' as const },
          { step: 'Deliver Certificate', status: 'pending' as const },
        ]
      : [
          { step: 'Generate CSR',        status: 'pending' as const },
          { step: 'Submit to CA',        status: 'pending' as const },
          { step: 'Install Certificate', status: 'pending' as const },
        ];

    const csr = await CSRRequest.create({
      commonName:              cert.commonName,
      subjectAlternativeNames: cert.subjectAlternativeNames || [],
      subject:                 cert.subject || {},
      serverType,
      keySize:                 cert.keySize || 2048,
      keyAlgorithm:            'RSA',
      hashAlgorithm:           'SHA256',
      keyUsage:                cert.keyUsage?.length ? cert.keyUsage : ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage:        cert.extendedKeyUsage?.length ? cert.extendedKeyUsage : ['serverAuth', 'clientAuth'],
      // templateCN is what certreq -attrib needs — fall back through templateRawValue → templateName
      templateName:            cert.templateCN || cert.templateRawValue || cert.templateName || 'WebServer',
      targetCAId:              resolvedCAId || undefined,
      targetServerId:          serverType === 'iis' ? (targetServerId || undefined) : undefined,
      applicationId:           cert.applicationId || undefined,
      deliveryEmails:          serverType === 'apache' ? deliveryEmails : [],
      status:                  'draft',
      requestedBy:             req.user?.username || 'unknown',
      requestedAt:             new Date(),
      workflowSteps,
    });

    logger.info(
      `Re-issue CSR draft created for ${cert.commonName} ` +
      `by ${req.user?.username} (csrId: ${csr._id}, originalCertId: ${cert._id})`
    );

    res.status(201).json({
      message:    'Re-issue draft created. Open the CSR to generate and submit.',
      csrId:      csr._id,
      commonName: cert.commonName,
      serverType: csr.serverType,
    });
  } catch (error) {
    logger.error('Re-issue certificate error:', error);
    res.status(500).json({ error: 'Failed to create re-issue request' });
  }
}

/**
 * POST /api/certificates/:id/renew
 *
 * Admin-only. Triggers the full auto-renewal pipeline for a single certificate
 * immediately, bypassing the daysBeforeExpiry window check and lastRenewalAt guard.
 * Intended for testing and manual intervention.
 */
export async function triggerAutoRenewal(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const cert = await Certificate.findById(id);
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    if (cert.status === 'revoked') {
      res.status(400).json({ error: 'Cannot renew a revoked certificate' });
      return;
    }

    if (!cert.serverType) {
      res.status(400).json({ error: 'Certificate has no serverType set — cannot auto-renew' });
      return;
    }

    if (!cert.autoRenew?.enabled) {
      res.status(400).json({ error: 'Auto-renewal is not enabled on this certificate. Enable it first.' });
      return;
    }

    logger.info(`Manual auto-renewal triggered for ${cert.commonName} by admin ${req.user?.username}`);

    const result = await runAutoRenewalForCert(cert);

    res.json({
      message: `Auto-renewal completed for ${cert.commonName}`,
      commonName: cert.commonName,
      ...result,
    });
  } catch (error: any) {
    logger.error('Manual auto-renewal error:', error);
    res.status(500).json({ error: error.message || 'Auto-renewal failed' });
  }
}