import cron from 'node-cron';
import { logger } from '../utils/logger';
import { sendExpirationNotifications } from './notificationService';
import { syncAllCAs } from './certificateService';

let notificationJob: cron.ScheduledTask | null = null;
let syncJob: cron.ScheduledTask | null = null;

export function initializeScheduler(): void {
  // Run expiration check daily at 8 AM
  notificationJob = cron.schedule('0 8 * * *', async () => {
    logger.info('Running scheduled expiration notification check');
    try {
      const result = await sendExpirationNotifications();
      logger.info(`Notification check complete: ${result.sent} sent, ${result.failed} failed`);
    } catch (error) {
      logger.error('Scheduled notification check failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York', // Adjust timezone as needed
  });

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

  logger.info('Scheduler stopped');
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
