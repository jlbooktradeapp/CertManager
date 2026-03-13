import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { User, UserRole } from '../models/User';
import { RefreshToken } from '../models/RefreshToken';
import { generateToken, generateRefreshToken } from '../middleware/auth';
import { generateMetadata } from '../config/saml';
import { logger } from '../utils/logger';

// Map SAML role attribute values to application roles
const ROLE_MAP: Record<string, UserRole> = {
  admin: 'admin',
  operator: 'operator',
  viewer: 'viewer',
};

/**
 * Initiate SAML SSO login — redirects to Azure Entra.
 * GET /api/auth/saml/login
 */
export function samlLogin(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('saml', {
    session: false,
    failureRedirect: '/login?error=saml_init_failed',
  })(req, res, next);
}

/**
 * SAML ACS callback — Azure Entra posts the assertion here.
 * POST /api/auth/saml/callback
 */
export function samlCallback(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('saml', { session: false }, async (err: Error | null, profile: any) => {
    try {
      if (err) {
        logger.error('SAML authentication error:', err);
        return res.redirect('/login?error=saml_auth_failed');
      }

      if (!profile) {
        logger.error('SAML authentication failed — no profile returned');
        return res.redirect('/login?error=saml_no_profile');
      }

      // Extract user attributes from SAML assertion
      const nameID = profile.nameID;
      const email = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']
        || profile.email
        || nameID;
      const displayName = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']
        || profile['http://schemas.microsoft.com/identity/claims/displayname']
        || profile.displayName
        || email;
      const username = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']
        || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn']
        || nameID?.split('@')[0]
        || nameID;

      // Extract role from SAML assertion
      const roleAttribute = profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
        || profile.role
        || profile['Role'];

      // Determine roles — roleAttribute can be a string or an array
      const roles: UserRole[] = [];
      const roleValues = Array.isArray(roleAttribute) ? roleAttribute : [roleAttribute];

      for (const roleValue of roleValues) {
        if (roleValue) {
          const normalizedRole = roleValue.toString().toLowerCase().trim();
          // Match against known role names
          if (ROLE_MAP[normalizedRole]) {
            roles.push(ROLE_MAP[normalizedRole]);
          } else {
            // Try matching group name patterns like "CertManager-Admins"
            const groupMatch = normalizedRole.match(/certmanager[- _]?(admin|operator|viewer)s?/i);
            if (groupMatch) {
              const mapped = ROLE_MAP[groupMatch[1].toLowerCase()];
              if (mapped) roles.push(mapped);
            }
          }
        }
      }

      // Default to viewer if no role could be determined
      if (roles.length === 0) {
        logger.warn(`No recognized role for user ${username} — defaulting to viewer. Role attribute: ${JSON.stringify(roleAttribute)}`);
        roles.push('viewer');
      }

      logger.info(`SAML login: ${username} (${email}) — roles: ${roles.join(', ')}`);

      // JIT provisioning — find or create user
      let user = await User.findOne({ username });

      if (user) {
        // Update on every login
        user.email = email;
        user.displayName = displayName;
        user.roles = roles;
        user.lastLogin = new Date();
        await user.save();
        logger.info(`Updated existing user: ${username}`);
      } else {
        user = await User.create({
          username,
          email,
          displayName,
          distinguishedName: `SAML:${nameID}`,
          roles,
          lastLogin: new Date(),
        });
        logger.info(`JIT provisioned new user: ${username}`);
      }

      // Generate JWT tokens (same as existing auth flow)
      const accessToken = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      // Store refresh token
      const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
      const expiresMs = parseDuration(refreshExpiresIn);
      await RefreshToken.create({
        token: refreshToken,
        userId: user._id,
        expiresAt: new Date(Date.now() + expiresMs),
      });

      // Redirect to frontend with tokens
      const redirectUrl = `/?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;
      res.redirect(redirectUrl);

    } catch (error) {
      logger.error('SAML callback processing error:', error);
      res.redirect('/login?error=saml_processing_failed');
    }
  })(req, res, next);
}

/**
 * SP metadata endpoint — useful for Azure Entra configuration.
 * GET /api/auth/saml/metadata
 */
export function samlMetadata(_req: Request, res: Response): void {
  const metadata = generateMetadata();
  if (!metadata) {
    res.status(503).json({ error: 'SAML is not configured' });
    return;
  }
  res.type('application/xml');
  res.send(metadata);
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