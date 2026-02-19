import { Router } from 'express';
import {
  listCertificates,
  getCertificate,
  getExpiringCertificates,
  getStats,
  triggerSync,
  deleteCertificate,
} from '../controllers/certificateController';
import { authenticate } from '../middleware/auth';
import { operatorOrAdmin, anyAuthenticated } from '../middleware/rbac';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/certificates - List all certificates
router.get('/', anyAuthenticated, listCertificates);

// GET /api/certificates/stats - Get certificate statistics
router.get('/stats', anyAuthenticated, getStats);

// GET /api/certificates/expiring - Get expiring certificates
router.get('/expiring', anyAuthenticated, getExpiringCertificates);

// POST /api/certificates/sync - Trigger CA sync
router.post('/sync', operatorOrAdmin, triggerSync);

// GET /api/certificates/:id - Get certificate details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getCertificate);

// DELETE /api/certificates/:id - Remove certificate from tracking
router.delete('/:id', operatorOrAdmin, validateObjectId('id'), deleteCertificate);

export default router;
