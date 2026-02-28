import { Router } from 'express';
import { getEligible, getStats, revokeAndDelete, triggerDigest } from '../controllers/cleanupController';
import { authenticate } from '../middleware/auth';
import { operatorOrAdmin } from '../middleware/rbac';

const router = Router();

// All cleanup routes require authentication and operator/admin role
router.use(authenticate);
router.use(operatorOrAdmin);

// GET /api/cleanup/eligible - Get certificates eligible for cleanup
router.get('/eligible', getEligible);

// GET /api/cleanup/stats - Get cleanup statistics
router.get('/stats', getStats);

// POST /api/cleanup/revoke-and-delete - Batch revoke and delete certificates
router.post('/revoke-and-delete', revokeAndDelete);

// POST /api/cleanup/digest - Manually trigger cleanup digest email
router.post('/digest', triggerDigest);

export default router;