import { Router } from 'express';
import {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  testServerConnectivity,
  getServerCertificates,
  deployCertificate,
  bindCertificate,
} from '../controllers/serverController';
import { authenticate } from '../middleware/auth';
import { adminOnly, operatorOrAdmin, anyAuthenticated } from '../middleware/rbac';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/servers - List managed servers
router.get('/', anyAuthenticated, listServers);

// POST /api/servers - Add server
router.post('/', adminOnly, createServer);

// GET /api/servers/:id - Get server details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getServer);

// PUT /api/servers/:id - Update server
router.put('/:id', adminOnly, validateObjectId('id'), updateServer);

// DELETE /api/servers/:id - Remove server
router.delete('/:id', adminOnly, validateObjectId('id'), deleteServer);

// POST /api/servers/:id/test - Test connectivity
router.post('/:id/test', operatorOrAdmin, validateObjectId('id'), testServerConnectivity);

// GET /api/servers/:id/certificates - Get server certificates
router.get('/:id/certificates', anyAuthenticated, validateObjectId('id'), getServerCertificates);

// POST /api/servers/:id/deploy - Deploy certificate
router.post('/:id/deploy', operatorOrAdmin, validateObjectId('id'), deployCertificate);

// POST /api/servers/:id/bind - Bind certificate to site
router.post('/:id/bind', operatorOrAdmin, validateObjectId('id'), bindCertificate);

export default router;
