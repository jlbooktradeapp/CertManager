import cron from 'node-cron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { sendExpirationNotifications } from './notificationService';
import { syncAllCAs } from './certificateService';
import { runDiscovery } from './discoveryService';
import { NotificationSettings } from '../models/NotificationSettings';

import cron from 'node-cron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { sendExpirationNotifications } from './notificationService';
import { syncAllCAs } from './certificateService';
import { runDiscovery } from './discoveryService';
import { NotificationSettings } from '../models/NotificationSettings';

let notificationJob: cron.ScheduledTask | null = null;
let syncJob: cron.ScheduledTask | null = null;
let cleanupJob: cron.ScheduledTask | null = null;
let discoveryJob: cron.ScheduledTask | null = null;

/**
 * Schedule (or reschedule) the notification job at the given hour.
 * Called at startup and whenever scheduleHour is changed in Settings.
 */
export function scheduleNotificationJob(hour: number): void {
  // Stop existing job if running
  if (notificationJob) {
    notificationJob.stop();
    notificationJob = null;
  }

  const cronExpr = `0 ${hour} * * *`;
  notificationJob = cron.schedule(cronExpr, async () => {
    logger.info('Running scheduled expiration notification check');
    try {
      const result = await sendExpirationNotifications();
      logger.info(`Notification check complete: ${result.sent} sent, ${result.failed} failed`);
    } catch (error) {
      logger.error('Scheduled notification check failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York',
  });

  logger.info(`Notification job scheduled at ${hour}:00 ET daily (cron: ${cronExpr})`);
}

export async function initializeScheduler(): Promise<void> {
  // Read scheduleHour from DB — fall back to 8 if settings not yet configured
  let scheduleHour = 8;
  try {
    const settings = await NotificationSettings.findOne().select('scheduleHour');
    if (typeof settings?.scheduleHour === 'number') {
      scheduleHour = settings.scheduleHour;
    }
  } catch (err) {
    logger.warn('Could not read scheduleHour from DB, defaulting to 8 AM:', err);
  }

  scheduleNotificationJob(scheduleHour);

  // Run CA sync every hour
  syncJob = cron.schedule('0 * * * *', async () => {
    logger.info('Running scheduled CA sync');
    try {
      await syncAllCAs();
      logger.info('Scheduled CA sync complete');
    } catch (error) {
      logger.error('Scheduled CA sync failed:', error);
    }
  }, {
    scheduled: true,
  });

  logger.info('Scheduler initialized with notification and sync jobs');

  // SEC-005 + SEC-026: Orphan private key and temp script cleanup every 15 minutes
  cleanupJob = cron.schedule('*/15 * * * *', () => {
    cleanupOrphanFiles();
  }, {
    scheduled: true,
  });

  logger.info('Orphan file cleanup job scheduled (every 15 minutes)');

  // Discovery: run daily at 2 AM ET — probe cert CN/SANs to find where certs are deployed
  // Only runs if discoveryConfig.enabled = true in settings
  discoveryJob = cron.schedule('0 2 * * *', async () => {
    try {
      const settings = await NotificationSettings.findOne().select('discoveryConfig');
      if (!settings?.discoveryConfig?.enabled) {
        logger.debug('Scheduled discovery skipped — disabled in settings');
        return;
      }
      logger.info('Running scheduled certificate discovery');
      const stats = await runDiscovery();
      logger.info(
        `Scheduled discovery complete: probed=${stats.hostnamesProbed}, matched=${stats.matched}, ` +
        `rebound=${stats.reboundFound}`
      );
    } catch (error) {
      logger.error('Scheduled discovery failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York',
  });

  logger.info('Discovery job scheduled (daily at 2:00 AM ET, runs when enabled in Settings)');
}

export function stopScheduler(): void {
  if (notificationJob) {
    notificationJob.stop();
    notificationJob = null;
  }

  if (syncJob) {
    syncJob.stop();
    syncJob = null;
  }

  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
  }

  if (discoveryJob) {
    discoveryJob.stop();
    discoveryJob = null;
  }

  logger.info('Scheduler stopped');
}

/**
 * SEC-005: Clean up orphan private key files (.key) older than 1 hour.
 * SEC-026: Clean up failed PowerShell temp scripts (.ps1) older than 1 hour.
 * Runs every 15 minutes via cron.
 */
function cleanupOrphanFiles(): void {
  const tmpDir = os.tmpdir();
  const maxAgeMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  let keysDeleted = 0;
  let scriptsDeleted = 0;

  try {
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      // Match orphan .key files (from OpenSSL CSR generation)
      // and orphan .csr / .cnf files
      const isOrphanKey = file.endsWith('.key') && /^[a-f0-9]{24}\.key$/.test(file);
      const isOrphanCSR = file.endsWith('.csr') && /^[a-f0-9]{24}\.csr$/.test(file);
      const isOrphanConf = file.endsWith('.cnf') && /^[a-f0-9]{24}\.cnf$/.test(file);
      // Match failed PowerShell temp scripts
      const isTempPS = file.startsWith('certmgr-ps-') && file.endsWith('.ps1');

      if (isOrphanKey || isOrphanCSR || isOrphanConf || isTempPS) {
        const filePath = path.join(tmpDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            if (isOrphanKey) {
              keysDeleted++;
              logger.warn(`Orphan private key deleted: ${file}`);
            } else if (isTempPS) {
              scriptsDeleted++;
              logger.info(`Orphan PS temp script deleted: ${file}`);
            } else {
              logger.info(`Orphan temp file deleted: ${file}`);
            }
          }
        } catch {}
      }
    }
    if (keysDeleted > 0 || scriptsDeleted > 0) {
      logger.info(`Orphan cleanup: ${keysDeleted} key file(s), ${scriptsDeleted} PS script(s) deleted`);
    }
  } catch (err: any) {
    logger.error(`Orphan file cleanup error: ${err.message}`);
  }
}

export function runNotificationCheckNow(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      logger.info('Running manual notification check');
      await sendExpirationNotifications();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

export function runSyncNow(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      logger.info('Running manual CA sync');
      await syncAllCAs();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}