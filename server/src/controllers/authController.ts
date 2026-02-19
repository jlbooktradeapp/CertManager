import { Request, Response } from 'express';
import { authenticateUser } from '../services/ldapService';
import { User, UserRole } from '../models/User';
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

    // Development bypass - allows login without AD
    if (process.env.NODE_ENV === 'development' && username === 'admin' && password === 'admin') {
      logger.warn('DEV MODE: Using development authentication bypass');

      let user = await User.findOne({ username: 'admin' });

      if (!user) {
        user = await User.create({
          username: 'admin',
          email: 'admin@localhost',
          displayName: 'Dev Admin',
          distinguishedName: 'CN=admin,DC=localhost',
          roles: ['admin'],
          lastLogin: new Date(),
        });
      } else {
        user.lastLogin = new Date();
        await user.save();
      }

      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user);

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

    const { userId } = verifyRefreshToken(refreshToken);
    const user = await User.findById(userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

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
  // In a production system, you might want to blacklist the token
  logger.info(`User logged out: ${req.user?.username}`);
  res.json({ message: 'Logged out successfully' });
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
