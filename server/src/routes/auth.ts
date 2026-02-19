import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, refresh, getCurrentUser } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Rate limiting for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window per IP
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many refresh requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/login - Authenticate user
router.post('/login', loginLimiter, login);

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', refreshLimiter, refresh);

// POST /api/auth/logout - End session
router.post('/logout', authenticate, logout);

// GET /api/auth/me - Get current user info
router.get('/me', authenticate, getCurrentUser);

export default router;
