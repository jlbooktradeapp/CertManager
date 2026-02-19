import { Router } from 'express';
import {
  listCAs,
  getCA,
  createCA,
  updateCA,
  deleteCA,
  syncCAById,
  getCATemplates,
} from '../controllers/caController';
import { authenticate } from '../middleware/auth';
import { adminOnly, operatorOrAdmin, anyAuthenticated } from '../middleware/rbac';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/ca - List all certificate authorities
router.get('/', anyAuthenticated, listCAs);

// POST /api/ca - Add new CA
router.post('/', adminOnly, createCA);

// GET /api/ca/:id - Get CA details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getCA);

// PUT /api/ca/:id - Update CA
router.put('/:id', adminOnly, validateObjectId('id'), updateCA);

// DELETE /api/ca/:id - Remove CA
router.delete('/:id', adminOnly, validateObjectId('id'), deleteCA);

// POST /api/ca/:id/sync - Sync certificates from CA
router.post('/:id/sync', operatorOrAdmin, validateObjectId('id'), syncCAById);

// GET /api/ca/:id/templates - Get available templates
router.get('/:id/templates', anyAuthenticated, validateObjectId('id'), getCATemplates);

export default router;
