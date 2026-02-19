import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';

// Route imports
import authRoutes from './routes/auth';
import certificateRoutes from './routes/certificates';
import caRoutes from './routes/ca';
import csrRoutes from './routes/csr';
import serverRoutes from './routes/servers';
import settingsRoutes from './routes/settings';

const app: Application = express();

// Security middleware
app.use(helmet());

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

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// API routes
const API_PREFIX = process.env.API_PREFIX || '/api';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/certificates`, certificateRoutes);
app.use(`${API_PREFIX}/ca`, caRoutes);
app.use(`${API_PREFIX}/csr`, csrRoutes);
app.use(`${API_PREFIX}/servers`, serverRoutes);
app.use(`${API_PREFIX}/settings`, settingsRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler — never leak internal details
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
