import { Router } from 'express';
import {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  // Phase 2: testServerConnectivity,
  // Phase 2: getServerCertificates,
  // Phase 2: deployCertificate,
  // Phase 2: bindCertificate,
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
// DISABLED: Requires WinRM/PSRemoting - Phase 2 feature
router.post('/:id/test', operatorOrAdmin, validateObjectId('id'), (_req, res) => {
  res.status(503).json({ error: 'Server connectivity testing is not yet enabled. This feature requires WinRM configuration and will be available in a future release.' });
});

// GET /api/servers/:id/certificates - Get server certificates
// DISABLED: Requires PSRemoting to remote servers - Phase 2 feature
router.get('/:id/certificates', anyAuthenticated, validateObjectId('id'), (_req, res) => {
  res.status(503).json({ error: 'Remote certificate retrieval is not yet enabled. This feature will be available in a future release.' });
});

// POST /api/servers/:id/deploy - Deploy certificate
// DISABLED: Requires admin rights + WinRM on target servers - Phase 2 feature
router.post('/:id/deploy', operatorOrAdmin, validateObjectId('id'), (_req, res) => {
  res.status(503).json({ error: 'Certificate deployment is not yet enabled. This feature will be available in a future release.' });
});

// POST /api/servers/:id/bind - Bind certificate to site
// DISABLED: Requires admin rights + WinRM on target servers - Phase 2 feature
router.post('/:id/bind', operatorOrAdmin, validateObjectId('id'), (_req, res) => {
  res.status(503).json({ error: 'Certificate binding is not yet enabled. This feature will be available in a future release.' });
});

export default router;
