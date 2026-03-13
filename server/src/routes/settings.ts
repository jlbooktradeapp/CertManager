import { Router } from 'express';
import {
  getNotificationSettings,
  updateNotificationSettings,
  testNotificationEmail,
  triggerNotifications,
  syncCalendar,
  getSyncSettings,
  updateSyncSettings,
} from '../controllers/settingsController';
import { updateDiscoverySettings } from '../controllers/discoveryController';
import { authenticate } from '../middleware/auth';
import { adminOnly, anyAuthenticated } from '../middleware/rbac';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/settings/notifications - Get notification config
router.get('/notifications', anyAuthenticated, getNotificationSettings);

// PUT /api/settings/notifications - Update notification config
router.put('/notifications', adminOnly, updateNotificationSettings);

// POST /api/settings/notifications/test - Send test email
router.post('/notifications/test', adminOnly, testNotificationEmail);

// POST /api/settings/notifications/trigger - Manually trigger notification job
router.post('/notifications/trigger', adminOnly, triggerNotifications);

// POST /api/settings/calendar/sync - Sync certificates to Teams calendar
router.post('/calendar/sync', adminOnly, syncCalendar);

// GET /api/settings/sync - Get sync settings
router.get('/sync', anyAuthenticated, getSyncSettings);

// PUT /api/settings/sync - Update sync settings
router.put('/sync', adminOnly, updateSyncSettings);

// PUT /api/settings/discovery - Update discovery configuration
router.put('/discovery', adminOnly, updateDiscoverySettings);

export default router;