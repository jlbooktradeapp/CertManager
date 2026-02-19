import { Router } from 'express';
import { login, logout, refresh, getCurrentUser } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /api/auth/login - Authenticate user
router.post('/login', login);

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', refresh);

// POST /api/auth/logout - End session
router.post('/logout', authenticate, logout);

// GET /api/auth/me - Get current user info
router.get('/me', authenticate, getCurrentUser);

export default router;
