import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { UserRole } from '../models/User';

// Role hierarchy: admin > operator > viewer
const roleHierarchy: Record<UserRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRoles = req.user.roles;
    const hasPermission = userRoles.some(role => allowedRoles.includes(role));

    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

export function requireMinRole(minRole: UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRoles = req.user.roles;
    const minLevel = roleHierarchy[minRole];
    const hasPermission = userRoles.some(role => roleHierarchy[role] >= minLevel);

    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

// Convenience middleware
export const adminOnly = requireRole('admin');
export const operatorOrAdmin = requireMinRole('operator');
export const anyAuthenticated = requireMinRole('viewer');
