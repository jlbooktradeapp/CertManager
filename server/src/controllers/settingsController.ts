import { Request, Response } from 'express';
import { NotificationSettings } from '../models/NotificationSettings';
import { sendTestEmail } from '../services/notificationService';
import { syncCertificatesToCalendar } from '../services/calendarService';
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
    if (safeSettings.calendarConfig?.graphClientSecret) {
      safeSettings.calendarConfig.graphClientSecret = '********';
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

    if (Array.isArray(updates.excludedTemplates)) {
      settings.excludedTemplates = updates.excludedTemplates;
    }

    if (updates.calendarConfig) {
      const cc = updates.calendarConfig;
      if (typeof cc.enabled === 'boolean') settings.calendarConfig.enabled = cc.enabled;
      if (cc.method) settings.calendarConfig.method = cc.method;
      if (cc.icsTargetEmail !== undefined) settings.calendarConfig.icsTargetEmail = cc.icsTargetEmail;
      if (cc.graphTenantId !== undefined) settings.calendarConfig.graphTenantId = cc.graphTenantId;
      if (cc.graphClientId !== undefined) settings.calendarConfig.graphClientId = cc.graphClientId;
      if (cc.graphClientSecret && cc.graphClientSecret !== '********') {
        settings.calendarConfig.graphClientSecret = cc.graphClientSecret;
      }
      if (cc.graphCalendarEmail !== undefined) settings.calendarConfig.graphCalendarEmail = cc.graphCalendarEmail;
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

export async function syncCalendar(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    logger.info(`Calendar sync triggered by ${req.user?.username}`);
    const result = await syncCertificatesToCalendar();
    res.json(result);
  } catch (error) {
    logger.error('Calendar sync error:', error);
    res.status(500).json({ error: 'Failed to sync calendar' });
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