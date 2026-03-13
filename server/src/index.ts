import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDatabase } from './config/database';
import { initializeSaml } from './config/saml';
import { logger } from './utils/logger';
import { initializeScheduler } from './services/schedulerService';

const PORT = process.env.PORT || 3000;

function validateRequiredEnv(): void {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
  }
  // SEC-015: Warn if NODE_ENV is not set to production
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('NODE_ENV is not set to "production". CORS, CSP, and security defaults may be permissive.');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    logger.error('CORS_ORIGIN is not set in production. Cross-origin requests will be rejected.');
  }
  // SEC-004: Warn if local test admin credentials are set in production
  if (process.env.NODE_ENV === 'production' && process.env.LOCAL_ADMIN_USER) {
    logger.error('LOCAL_ADMIN_USER is set in production. This account is disabled in production mode — remove these variables.');
  }
  // SAML SSO configuration check
  const samlVars = ['SAML_ENTRY_POINT', 'SAML_ISSUER', 'SAML_CALLBACK_URL'];
  const missingSaml = samlVars.filter(key => !process.env[key]);
  const hasCert = process.env.SAML_CERT || process.env.SAML_CERT_PATH;
  if (!hasCert) missingSaml.push('SAML_CERT or SAML_CERT_PATH');
  if (missingSaml.length > 0 && missingSaml.length < samlVars.length) {
    logger.warn(`Partial SAML configuration detected. Missing: ${missingSaml.join(', ')}. SAML SSO will not be available.`);
  }
  if (process.env.NODE_ENV === 'production' && missingSaml.length > 0) {
    logger.error(`SAML SSO is not fully configured in production. Missing: ${missingSaml.join(', ')}. Users will not be able to log in.`);
  }
}

async function startServer(): Promise<void> {
  try {
    // Validate configuration before starting
    validateRequiredEnv();

    // Connect to MongoDB
    await connectDatabase();
    logger.info('Connected to MongoDB');

    // Initialize SAML SSO strategy
    initializeSaml();

    // Initialize scheduled jobs
    initializeScheduler();
    logger.info('Scheduler initialized');

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();