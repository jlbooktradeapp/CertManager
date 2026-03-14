import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { logger } from './utils/logger';

// Route imports
import authRoutes from './routes/auth';
import certificateRoutes from './routes/certificates';
import caRoutes from './routes/ca';
import csrRoutes from './routes/csr';
import serverRoutes from './routes/servers';
import settingsRoutes from './routes/settings';
import applicationRoutes from './routes/applications';
import cleanupRoutes from './routes/cleanup';

const app: Application = express();

// Trust nginx reverse proxy for X-Forwarded-For headers
app.set('trust proxy', 1);

// SEC-013: Security middleware with explicit CSP configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // MUI requires inline styles
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS configuration
const corsOrigin = process.env.NODE_ENV === 'production'
  ? process.env.CORS_ORIGIN
  : 'http://localhost:5173';

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  logger.warn('CORS_ORIGIN not set in production. CORS will reject all cross-origin requests.');
}

app.use(cors({
  origin: corsOrigin || false,
  credentials: true,
}));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Initialize Passport (used for SAML SSO)
app.use(passport.initialize());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// SEC-006: Global rate limiting — 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path === '/health',  // Don't rate-limit health checks
});
app.use(globalLimiter);

// API routes
const API_PREFIX = process.env.API_PREFIX || '/api';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/certificates`, certificateRoutes);
app.use(`${API_PREFIX}/ca`, caRoutes);
app.use(`${API_PREFIX}/csr`, csrRoutes);
app.use(`${API_PREFIX}/servers`, serverRoutes);
app.use(`${API_PREFIX}/settings`, settingsRoutes);
app.use(`${API_PREFIX}/applications`, applicationRoutes);
app.use(`${API_PREFIX}/cleanup`, cleanupRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React frontend in production
// The built client files sit at ../../client/dist relative to server/src
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));

  // SPA catch-all — any non-API route serves index.html so React Router handles it
  app.get('*', (req: Request, res: Response) => {
    // Don't catch API routes — those should 404 normally
    if (req.path.startsWith(`${API_PREFIX}/`)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  // Development: Vite serves the frontend on its own port (5173)
  // API 404 handler only
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });
}

// Error handler — never leak internal details
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;