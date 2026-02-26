import { Router } from 'express';
import {
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
  deleteApplication,
  importApplicationsCSV,
} from '../controllers/applicationController';
import { authenticate } from '../middleware/auth';
import { adminOnly, anyAuthenticated } from '../middleware/rbac';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/applications - List applications
router.get('/', anyAuthenticated, listApplications);

// POST /api/applications - Create application
router.post('/', adminOnly, createApplication);

// POST /api/applications/import - Import from CSV
router.post('/import', adminOnly, importApplicationsCSV);

// GET /api/applications/:id - Get application details
router.get('/:id', anyAuthenticated, validateObjectId('id'), getApplication);

// PUT /api/applications/:id - Update application
router.put('/:id', adminOnly, validateObjectId('id'), updateApplication);

// DELETE /api/applications/:id - Delete application
router.delete('/:id', adminOnly, validateObjectId('id'), deleteApplication);

export default router;