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

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Anonymous relay - no authentication required
    // The internal SMTP gateway handles relay authorization
    tls: {
      rejectUnauthorized: false,
    },
  });
}