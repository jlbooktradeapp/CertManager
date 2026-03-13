import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, refresh, getCurrentUser } from '../controllers/authController';
import { samlLogin, samlCallback, samlMetadata } from '../controllers/samlController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Rate limiting for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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

// SAML SSO routes
router.get('/saml/login', samlLogin);
router.post('/saml/callback', samlCallback);
router.get('/saml/metadata', samlMetadata);

// Local dev login (disabled in production)
router.post('/login', loginLimiter, login);

// Token management
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getCurrentUser);

export default router;