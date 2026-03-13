import { Router } from 'express';
import {
  listCertificates,
  getCertificate,
  getExpiringCertificates,
  getStats,
  getTemplateNames,
  getOrganizationalUnits,
  triggerSync,
  updateCertificate,
  deleteCertificate,
  reissueCertificate,
} from '../controllers/certificateController';
import { triggerDiscovery, getDiscoveryStatus } from '../controllers/discoveryController';
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

// GET /api/certificates/templates - Get distinct template names
router.get('/templates', anyAuthenticated, getTemplateNames);

// GET /api/certificates/ous - Get distinct organizational units
router.get('/ous', anyAuthenticated, getOrganizationalUnits);

// GET /api/certificates/expiring - Get expiring certificates
router.get('/expiring', anyAuthenticated, getExpiringCertificates);

// POST /api/certificates/sync - Trigger CA sync
router.post('/sync', operatorOrAdmin, triggerSync);

// GET /api/certificates/discover/status - Get discovery run status + last stats
router.get('/discover/status', anyAuthenticated, getDiscoveryStatus);

// POST /api/certificates/discover - Trigger full discovery (or ?certId= for single cert)
router.post('/discover', operatorOrAdmin, triggerDiscovery);

// GET /api/certificates/:id - Get certificate details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getCertificate);

// PUT /api/certificates/:id - Update certificate (notification recipients, etc.)
router.put('/:id', operatorOrAdmin, validateObjectId('id'), updateCertificate);

// POST /api/certificates/:id/reissue - Create a pre-populated CSR draft for re-issuance
router.post('/:id/reissue', operatorOrAdmin, validateObjectId('id'), reissueCertificate);

// DELETE /api/certificates/:id - Remove certificate from tracking
router.delete('/:id', operatorOrAdmin, validateObjectId('id'), deleteCertificate);

export default router;