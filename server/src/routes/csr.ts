import { Router } from 'express';
import {
  listCSRs,
  getCSR,
  createCSR,
  updateCSR,
  generateCSR,
  submitCSRToCA,
  deleteCSR,
} from '../controllers/csrController';
import { authenticate } from '../middleware/auth';
import { operatorOrAdmin, anyAuthenticated } from '../middleware/rbac';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/csr - List CSR requests
router.get('/', anyAuthenticated, listCSRs);

// POST /api/csr - Create new CSR request
router.post('/', operatorOrAdmin, createCSR);

// GET /api/csr/:id - Get CSR details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getCSR);

// PUT /api/csr/:id - Update CSR
router.put('/:id', operatorOrAdmin, validateObjectId('id'), updateCSR);

// POST /api/csr/:id/generate - Generate CSR on target
router.post('/:id/generate', operatorOrAdmin, validateObjectId('id'), generateCSR);

// POST /api/csr/:id/submit - Submit to CA
router.post('/:id/submit', operatorOrAdmin, validateObjectId('id'), submitCSRToCA);

// DELETE /api/csr/:id - Cancel/delete CSR
router.delete('/:id', operatorOrAdmin, validateObjectId('id'), deleteCSR);

export default router;
