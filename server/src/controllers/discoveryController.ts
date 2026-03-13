import { Request, Response } from 'express';
import { runDiscovery } from '../services/discoveryService';
import { NotificationSettings } from '../models/NotificationSettings';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

let discoveryInProgress = false;

/**
 * POST /api/certificates/discover
 * Triggers a full discovery pass (or single-cert if ?certId= is provided).
 * Operator+ only. Runs in the background and returns immediately.
 */
export async function triggerDiscovery(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (discoveryInProgress) {
      res.status(429).json({ error: 'Discovery is already in progress. Please wait for it to complete.' });
      return;
    }

    const certId = req.query.certId as string | undefined;

    logger.info(`Discovery triggered by ${req.user?.username}${certId ? ` for cert ${certId}` : ' (full scan)'}`);

    discoveryInProgress = true;

    // Run in background — don't await
    runDiscovery(certId)
      .catch((err) => logger.error('Background discovery error:', err))
      .finally(() => { discoveryInProgress = false; });

    res.json({
      message: certId
        ? 'Discovery started for the selected certificate.'
        : 'Full discovery scan started. Results will appear on certificate records as probes complete.',
      inProgress: true,
    });
  } catch (error) {
    discoveryInProgress = false;
    logger.error('Trigger discovery error:', error);
    res.status(500).json({ error: 'Failed to start discovery' });
  }
}

/**
 * GET /api/certificates/discover/status
 * Returns whether discovery is running and the stats from the last run.
 */
export async function getDiscoveryStatus(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await NotificationSettings.findOne().select('discoveryConfig');
    res.json({
      inProgress: discoveryInProgress,
      config: settings?.discoveryConfig ?? null,
    });
  } catch (error) {
    logger.error('Get discovery status error:', error);
    res.status(500).json({ error: 'Failed to get discovery status' });
  }
}

/**
 * PUT /api/settings/discovery
 * Update discovery configuration (ports, timeout, concurrency, enabled).
 * Admin only.
 */
export async function updateDiscoverySettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enabled, probePorts, probeTimeoutMs, concurrency, f5IpRanges } = req.body;

    let settings = await NotificationSettings.findOne();
    if (!settings) {
      settings = new NotificationSettings();
    }

    if (typeof enabled === 'boolean') {
      settings.discoveryConfig.enabled = enabled;
    }
    if (Array.isArray(probePorts)) {
      const ports = probePorts
        .map((p: any) => parseInt(p, 10))
        .filter((p: number) => !isNaN(p) && p > 0 && p <= 65535);
      if (ports.length > 0) settings.discoveryConfig.probePorts = ports;
    }
    if (typeof probeTimeoutMs === 'number' && probeTimeoutMs >= 1000 && probeTimeoutMs <= 30000) {
      settings.discoveryConfig.probeTimeoutMs = probeTimeoutMs;
    }
    if (typeof concurrency === 'number' && concurrency >= 1 && concurrency <= 50) {
      settings.discoveryConfig.concurrency = concurrency;
    }
    if (Array.isArray(f5IpRanges)) {
      settings.discoveryConfig.f5IpRanges = f5IpRanges
        .map((r: any) => String(r).trim())
        .filter(Boolean);
    }

    await settings.save();
    logger.info(`Discovery settings updated by ${req.user?.username}`);
    res.json(settings.discoveryConfig);
  } catch (error) {
    logger.error('Update discovery settings error:', error);
    res.status(500).json({ error: 'Failed to update discovery settings' });
  }
}