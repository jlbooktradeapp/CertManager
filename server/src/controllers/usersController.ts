import { Response } from 'express';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * GET /api/users
 * Returns all users who have authenticated into CertManager via SAML SSO.
 * Admin only.
 */
export async function listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const users = await User.find({})
      .select('username email displayName roles lastLogin createdAt')
      .sort({ displayName: 1 });

    res.json({ data: users, total: users.length });
  } catch (error) {
    logger.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
}