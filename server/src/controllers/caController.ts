import { Request, Response } from 'express';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { syncCA } from '../services/certificateService';
import { executePowerShell, validateConfigString, sanitizePSString } from '../services/powershellService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function listCAs(req: Request, res: Response): Promise<void> {
  try {
    const cas = await CertificateAuthority.find()
      .populate('parentCAId', 'name displayName')
      .sort({ type: 1, name: 1 });

    res.json(cas);
  } catch (error) {
    logger.error('List CAs error:', error);
    res.status(500).json({ error: 'Failed to list certificate authorities' });
  }
}

export async function getCA(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const ca = await CertificateAuthority.findById(id)
      .populate('parentCAId', 'name displayName');

    if (!ca) {
      res.status(404).json({ error: 'Certificate authority not found' });
      return;
    }

    res.json(ca);
  } catch (error) {
    logger.error('Get CA error:', error);
    res.status(500).json({ error: 'Failed to get certificate authority' });
  }
}

export async function createCA(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      name,
      displayName,
      type,
      parentCAId,
      hostname,
      configString,
      syncEnabled = true,
      syncIntervalMinutes = 60,
    } = req.body;

    // Validate required fields
    if (!name || !displayName || !type || !hostname || !configString) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check for duplicate
    const existing = await CertificateAuthority.findOne({ name });
    if (existing) {
      res.status(409).json({ error: 'Certificate authority with this name already exists' });
      return;
    }

    const ca = await CertificateAuthority.create({
      name,
      displayName,
      type,
      parentCAId: parentCAId || undefined,
      hostname,
      configString,
      syncEnabled,
      syncIntervalMinutes,
      status: 'unknown',
    });

    logger.info(`CA ${name} created by ${req.user?.username}`);

    res.status(201).json(ca);
  } catch (error) {
    logger.error('Create CA error:', error);
    res.status(500).json({ error: 'Failed to create certificate authority' });
  }
}

export async function updateCA(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Whitelist allowed fields to prevent mass assignment
    const allowedFields = ['displayName', 'hostname', 'configString', 'syncEnabled', 'syncIntervalMinutes', 'status'] as const;
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const ca = await CertificateAuthority.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!ca) {
      res.status(404).json({ error: 'Certificate authority not found' });
      return;
    }

    logger.info(`CA ${ca.name} updated by ${req.user?.username}`);

    res.json(ca);
  } catch (error) {
    logger.error('Update CA error:', error);
    res.status(500).json({ error: 'Failed to update certificate authority' });
  }
}

export async function deleteCA(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const ca = await CertificateAuthority.findById(id);

    if (!ca) {
      res.status(404).json({ error: 'Certificate authority not found' });
      return;
    }

    // Check if it's a parent to other CAs
    const children = await CertificateAuthority.countDocuments({ parentCAId: id });
    if (children > 0) {
      res.status(400).json({ error: 'Cannot delete CA with subordinate CAs' });
      return;
    }

    await ca.deleteOne();

    logger.info(`CA ${ca.name} deleted by ${req.user?.username}`);

    res.json({ message: 'Certificate authority deleted' });
  } catch (error) {
    logger.error('Delete CA error:', error);
    res.status(500).json({ error: 'Failed to delete certificate authority' });
  }
}

export async function syncCAById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const ca = await CertificateAuthority.findById(id);

    if (!ca) {
      res.status(404).json({ error: 'Certificate authority not found' });
      return;
    }

    logger.info(`Manual CA sync for ${ca.name} triggered by ${req.user?.username}`);

    const syncedCount = await syncCA(ca);

    res.json({
      message: 'Sync completed',
      certificatesSynced: syncedCount,
    });
  } catch (error) {
    logger.error('Sync CA error:', error);
    res.status(500).json({ error: 'Failed to sync certificate authority' });
  }
}

export async function getCATemplates(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const ca = await CertificateAuthority.findById(id);

    if (!ca) {
      res.status(404).json({ error: 'Certificate authority not found' });
      return;
    }

    // If templates are cached and recent, return them
    if (ca.templates.length > 0) {
      res.json(ca.templates);
      return;
    }

    // Validate configString before use in PowerShell
    if (!validateConfigString(ca.configString)) {
      res.status(400).json({ error: 'Invalid CA config string' });
      return;
    }

    // Otherwise fetch from CA
    const result = await executePowerShell({
      script: `
        $templates = certutil -CATemplates -config '${sanitizePSString(ca.configString)}' 2>$null |
          Where-Object { $_ -match '^\\s*[^:]+:' } |
          ForEach-Object {
            $parts = $_ -split ':'
            @{
              name = $parts[0].Trim()
              displayName = if($parts[1]) { $parts[1].Trim() } else { $parts[0].Trim() }
              oid = ''
            }
          }
        $templates | ConvertTo-Json -Compress
      `,
    });

    if (result.success && result.output) {
      try {
        let templates = JSON.parse(result.output);
        if (!Array.isArray(templates)) {
          templates = [templates];
        }

        // Cache templates
        ca.templates = templates;
        await ca.save();

        res.json(templates);
      } catch {
        res.json(ca.templates);
      }
    } else {
      res.json(ca.templates);
    }
  } catch (error) {
    logger.error('Get CA templates error:', error);
    res.status(500).json({ error: 'Failed to get CA templates' });
  }
}
