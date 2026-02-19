import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDatabase } from './config/database';
import { logger } from './utils/logger';
import { initializeScheduler } from './services/schedulerService';

const PORT = process.env.PORT || 3000;

function validateRequiredEnv(): void {
  const required = ['JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
}

async function startServer(): Promise<void> {
  try {
    // Validate configuration before starting
    validateRequiredEnv();

    // Connect to MongoDB
    await connectDatabase();
    logger.info('Connected to MongoDB');

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
