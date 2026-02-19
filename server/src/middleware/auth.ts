import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { User, IUser } from '../models/User';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  token?: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  roles: string[];
  iat: number;
  exp: number;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a secure value of at least 32 characters');
  }
  return secret;
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET || (getJwtSecret() + '-refresh');
  return secret;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const secret = getJwtSecret();

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload & { type?: string };

    // Reject refresh tokens used as access tokens
    if (decoded.type === 'refresh') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    logger.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

export function generateToken(user: IUser): string {
  const secret = getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    userId: user._id.toString(),
    username: user.username,
    roles: user.roles,
  };

  const options: SignOptions = { algorithm: 'HS256', expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export function generateRefreshToken(user: IUser): string {
  const secret = getJwtRefreshSecret();
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

  const options: SignOptions = { algorithm: 'HS256', expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(
    { userId: user._id.toString(), type: 'refresh' },
    secret,
    options
  );
}

export function verifyRefreshToken(token: string): { userId: string } {
  const secret = getJwtRefreshSecret();
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { userId: string; type: string };

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid refresh token');
  }

  return { userId: decoded.userId };
}
