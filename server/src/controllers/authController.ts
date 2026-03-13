import { Request, Response } from 'express';
import { User, UserRole } from '../models/User';
import { RefreshToken } from '../models/RefreshToken';
import { generateToken, generateRefreshToken, verifyRefreshToken, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Local development login — ONLY available when NODE_ENV !== 'production'
 * and LOCAL_ADMIN_USER/PASSWORD are set. In production, all auth goes through SAML SSO.
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // SEC-004: Local test account — ONLY available in development mode
    const localUser = process.env.LOCAL_ADMIN_USER;
    const localPass = process.env.LOCAL_ADMIN_PASSWORD;

    if (process.env.NODE_ENV === 'production') {
      logger.error('Local login attempted in production mode — denied. Use SAML SSO.');
      res.status(401).json({ error: 'Local login is disabled in production. Use SSO to sign in.' });
      return;
    }

    if (!localUser || !localPass) {
      res.status(401).json({ error: 'No local credentials configured. Set LOCAL_ADMIN_USER/PASSWORD in .env for development.' });
      return;
    }

    if (username !== localUser || password !== localPass) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    logger.warn(`Local test account login: ${username} (development mode only)`);

    // Find or create the local dev user
    let user = await User.findOne({ username: localUser });

    if (user) {
      user.lastLogin = new Date();
      await user.save();
    } else {
      user = await User.create({
        username: localUser,
        email: process.env.LOCAL_ADMIN_EMAIL || 'admin@test.local',
        displayName: process.env.LOCAL_ADMIN_DISPLAYNAME || 'Local Admin',
        distinguishedName: `CN=${localUser},OU=Local,DC=test,DC=local`,
        roles: ['admin'] as UserRole[],
        lastLogin: new Date(),
      });
    }

    // Generate tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const expiresMs = parseDuration(refreshExpiresIn);
    await RefreshToken.create({
      token: refreshToken,
      userId: user._id,
      expiresAt: new Date(Date.now() + expiresMs),
    });

    logger.info(`User logged in: ${user.username}`);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    // Check if token exists in database and is not revoked
    const storedToken = await RefreshToken.findOne({ token: refreshToken });

    if (!storedToken || storedToken.revoked) {
      if (storedToken?.revoked) {
        await RefreshToken.updateMany(
          { userId: storedToken.userId },
          { revoked: true, revokedAt: new Date() }
        );
        logger.warn(`Refresh token reuse detected for user ${storedToken.userId}, revoking all tokens`);
      }
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const { userId } = verifyRefreshToken(refreshToken);
    const user = await User.findById(userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Revoke the old refresh token (single-use rotation)
    storedToken.revoked = true;
    storedToken.revokedAt = new Date();
    await storedToken.save();

    // Issue new tokens
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const expiresMs = parseDuration(refreshExpiresIn);
    await RefreshToken.create({
      token: newRefreshToken,
      userId: user._id,
      expiresAt: new Date(Date.now() + expiresMs),
    });

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (req.user) {
      await RefreshToken.updateMany(
        { userId: req.user._id, revoked: false },
        { revoked: true, revokedAt: new Date() }
      );
    }

    logger.info(`User logged out: ${req.user?.username}`);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.json({ message: 'Logged out successfully' });
  }
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json({
    id: user._id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    preferences: user.preferences,
    lastLogin: user.lastLogin,
  });
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] || 1);
}