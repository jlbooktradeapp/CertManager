import { Router } from 'express';
import { listUsers } from '../controllers/usersController';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/rbac';

const router = Router();

router.use(authenticate);

// GET /api/users — list all users (Admin only)
router.get('/', adminOnly, listUsers);

export default router;