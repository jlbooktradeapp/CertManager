import { Request, Response } from 'express';
import { authenticateUser } from '../services/ldapService';
import { User, UserRole } from '../models/User';
import { RefreshToken } from '../models/RefreshToken';
import { generateToken, generateRefreshToken, verifyRefreshToken, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

// Map AD groups to application roles
const groupRoleMapping: Record<string, UserRole> = {
  'CertManager-Admins': 'admin',
  'CertManager-Operators': 'operator',
  'CertManager-Viewers': 'viewer',
};

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Authenticate against AD
    const ldapUser = await authenticateUser(username, password);

    if (!ldapUser) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Map AD groups to roles
    const roles: UserRole[] = [];
    for (const group of ldapUser.memberOf) {
      const groupName = extractGroupName(group);
      if (groupRoleMapping[groupName]) {
        roles.push(groupRoleMapping[groupName]);
      }
    }

    // Default to viewer if no roles assigned
    if (roles.length === 0) {
      roles.push('viewer');
    }

    // Find or create user in database
    let user = await User.findOne({ username: ldapUser.username });

    if (user) {
      // Update user info from AD
      user.email = ldapUser.email;
      user.displayName = ldapUser.displayName;
      user.distinguishedName = ldapUser.distinguishedName;
      user.roles = roles;
      user.lastLogin = new Date();
      await user.save();
    } else {
      // Create new user
      user = await User.create({
        username: ldapUser.username,
        email: ldapUser.email,
        displayName: ldapUser.displayName,
        distinguishedName: ldapUser.distinguishedName,
        roles,
        lastLogin: new Date(),
      });
    }

    // Generate tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token in database for revocation support
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
      // If a revoked token is reused, revoke all tokens for this user (possible theft)
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

    // Store new refresh token
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
    // Revoke all refresh tokens for this user
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

function extractGroupName(dn: string): string {
  const match = dn.match(/CN=([^,]+)/i);
  return match ? match[1] : '';
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] || 1);
}
