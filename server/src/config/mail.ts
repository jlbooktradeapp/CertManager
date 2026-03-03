import nodemailer from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
}

export function getMailConfig(fromOverride?: string): MailConfig {
  return {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    secure: process.env.SMTP_SECURE === 'true',
    from: fromOverride || process.env.SMTP_FROM || 'Certificate Manager <noreply@localhost>',
  };
}

export function createMailTransporter(): nodemailer.Transporter {
  const config = getMailConfig();

  // SEC-009: Enable TLS certificate verification in production.
  // If the internal relay uses an internal CA cert, add it to NODE_EXTRA_CA_CERTS.
  const rejectUnauthorized = process.env.NODE_ENV === 'production'
    ? (process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false')  // default true in prod
    : false;  // permissive in dev for self-signed relay certs

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Anonymous relay - no authentication required
    // The internal SMTP gateway handles relay authorization
    tls: {
      rejectUnauthorized,
    },
  });
}