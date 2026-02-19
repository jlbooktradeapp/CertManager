import { Request, Response } from 'express';
import { NotificationSettings } from '../models/NotificationSettings';
import { sendTestEmail } from '../services/notificationService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function getNotificationSettings(req: Request, res: Response): Promise<void> {
  try {
    let settings = await NotificationSettings.findOne();

    if (!settings) {
      // Create default settings
      settings = await NotificationSettings.create({
        enabled: false,
        smtpConfig: {
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            encryptedPassword: '',
          },
          from: process.env.SMTP_FROM || 'Certificate Manager <noreply@localhost>',
        },
        thresholds: [
          { days: 90, enabled: true },
          { days: 60, enabled: true },
          { days: 30, enabled: true },
          { days: 14, enabled: true },
          { days: 7, enabled: true },
          { days: 1, enabled: true },
        ],
        recipients: [],
        scheduleHour: 8,
      });
    }

    // Don't send password to client
    const safeSettings = settings.toObject();
    if (safeSettings.smtpConfig.auth) {
      safeSettings.smtpConfig.auth.encryptedPassword = safeSettings.smtpConfig.auth.encryptedPassword ? '********' : '';
    }

    res.json(safeSettings);
  } catch (error) {
    logger.error('Get notification settings error:', error);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
}

export async function updateNotificationSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const updates = req.body;

    let settings = await NotificationSettings.findOne();

    if (!settings) {
      settings = new NotificationSettings();
    }

    // Update fields
    if (typeof updates.enabled === 'boolean') {
      settings.enabled = updates.enabled;
    }

    if (updates.smtpConfig) {
      if (updates.smtpConfig.host) settings.smtpConfig.host = updates.smtpConfig.host;
      if (updates.smtpConfig.port) settings.smtpConfig.port = updates.smtpConfig.port;
      if (typeof updates.smtpConfig.secure === 'boolean') settings.smtpConfig.secure = updates.smtpConfig.secure;
      if (updates.smtpConfig.auth?.user) settings.smtpConfig.auth.user = updates.smtpConfig.auth.user;
      if (updates.smtpConfig.auth?.encryptedPassword && updates.smtpConfig.auth.encryptedPassword !== '********') {
        settings.smtpConfig.auth.encryptedPassword = updates.smtpConfig.auth.encryptedPassword;
      }
      if (updates.smtpConfig.from) settings.smtpConfig.from = updates.smtpConfig.from;
    }

    if (updates.thresholds) {
      settings.thresholds = updates.thresholds;
    }

    if (updates.recipients) {
      settings.recipients = updates.recipients;
    }

    if (typeof updates.scheduleHour === 'number') {
      settings.scheduleHour = Math.max(0, Math.min(23, updates.scheduleHour));
    }

    await settings.save();

    logger.info(`Notification settings updated by ${req.user?.username}`);

    // Return sanitized settings
    const safeSettings = settings.toObject();
    if (safeSettings.smtpConfig.auth) {
      safeSettings.smtpConfig.auth.encryptedPassword = safeSettings.smtpConfig.auth.encryptedPassword ? '********' : '';
    }

    res.json(safeSettings);
  } catch (error) {
    logger.error('Update notification settings error:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
}

export async function testNotificationEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email address is required' });
      return;
    }

    logger.info(`Test email requested to ${email} by ${req.user?.username}`);

    const success = await sendTestEmail(email);

    if (success) {
      res.json({ message: 'Test email sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send test email' });
    }
  } catch (error) {
    logger.error('Test email error:', error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
}

export async function getSyncSettings(req: Request, res: Response): Promise<void> {
  try {
    // Return sync-related settings from environment and CA configs
    res.json({
      defaultSyncInterval: 60,
      autoSync: true,
      lastSyncTime: null, // Would be fetched from a status collection
    });
  } catch (error) {
    logger.error('Get sync settings error:', error);
    res.status(500).json({ error: 'Failed to get sync settings' });
  }
}

export async function updateSyncSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { defaultSyncInterval, autoSync } = req.body;

    logger.info(`Sync settings updated by ${req.user?.username}`);

    res.json({
      defaultSyncInterval: defaultSyncInterval || 60,
      autoSync: autoSync !== false,
    });
  } catch (error) {
    logger.error('Update sync settings error:', error);
    res.status(500).json({ error: 'Failed to update sync settings' });
  }
}
