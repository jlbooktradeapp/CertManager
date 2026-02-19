import { Router } from 'express';
import {
  getNotificationSettings,
  updateNotificationSettings,
  testNotificationEmail,
  getSyncSettings,
  updateSyncSettings,
} from '../controllers/settingsController';
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

// GET /api/settings/sync - Get sync settings
router.get('/sync', anyAuthenticated, getSyncSettings);

// PUT /api/settings/sync - Update sync settings
router.put('/sync', adminOnly, updateSyncSettings);

export default router;
