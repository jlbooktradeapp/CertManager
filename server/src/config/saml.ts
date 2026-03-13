import * as fs from 'fs';
import passport from 'passport';
import { Strategy as SamlStrategy, Profile, VerifiedCallback } from '@node-saml/passport-saml';
import { logger } from '../utils/logger';

/**
 * Load the SAML signing certificate from file path or inline env var.
 * Strips PEM headers/footers and newlines so passport-saml gets raw base64.
 */
function loadSamlCert(): string | null {
  // Prefer file path
  const certPath = process.env.SAML_CERT_PATH;
  if (certPath) {
    if (!fs.existsSync(certPath)) {
      logger.error(`SAML certificate file not found: ${certPath}`);
      return null;
    }
    const raw = fs.readFileSync(certPath, 'utf-8');
    return raw
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\r?\n/g, '')
      .trim();
  }
  return null;
}

export function initializeSaml(): void {
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer = process.env.SAML_ISSUER;
  const callbackUrl = process.env.SAML_CALLBACK_URL;
  const cert = loadSamlCert();
  logger.info(`SAML cert loaded, length: ${cert?.length || 0} chars`);

  if (!entryPoint || !issuer || !cert || !callbackUrl) {
    logger.warn('SAML environment variables not fully configured — SAML SSO will not be available');
    return;
  }

  const strategy = new SamlStrategy(
    {
      entryPoint,
      issuer,
      callbackUrl,
      idpCert: cert,
      wantAuthnResponseSigned: false,
      wantAssertionsSigned: true,
      acceptedClockSkewMs: 5000,
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      disableRequestedAuthnContext: true,
    },
    // Verify callback — called when SAML assertion is received
    (profile: Profile, done: VerifiedCallback) => {
      if (!profile) {
        return done(new Error('No SAML profile returned'));
      }
      return done(null, profile);
    },
    // Logout callback (not used yet — SLO is P3)
    (profile: Profile, done: VerifiedCallback) => {
      return done(null, profile);
    }
  );

  passport.use('saml', strategy);

  // Serialize/deserialize (minimal — we use JWT, not sessions)
  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  logger.info('SAML SSO strategy initialized');
}

/**
 * Generate SP metadata XML for Azure Entra configuration.
 */
export function generateMetadata(): string | null {
  const strategy = passport._strategy('saml') as any;
  if (!strategy || !strategy.generateServiceProviderMetadata) {
    return null;
  }
  return strategy.generateServiceProviderMetadata(null, null);
}