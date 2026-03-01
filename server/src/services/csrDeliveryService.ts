import * as fs from 'fs';
import { createMailTransporter, getMailConfig } from '../config/mail';
import { deletePrivateKey, getKeyPath } from './opensslService';
import { logger } from '../utils/logger';

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

/**
 * Deliver an Apache certificate via email.
 * Sends the signed certificate (.cer) and private key (.key) as attachments,
 * then immediately deletes the private key from disk.
 */
export async function deliverApacheCertificate(options: {
  csrId: string;
  commonName: string;
  recipients: string[];
  certPEM: string;
  requestedBy: string;
}): Promise<DeliveryResult> {
  const { csrId, commonName, recipients, certPEM, requestedBy } = options;

  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No delivery email addresses specified' };
  }

  if (!certPEM) {
    return { success: false, error: 'No issued certificate PEM available' };
  }

  const keyPath = getKeyPath(csrId);

  // Verify private key still exists
  if (!fs.existsSync(keyPath)) {
    return { success: false, error: `Private key file not found at ${keyPath}. It may have already been delivered or cleaned up.` };
  }

  const keyPEM = fs.readFileSync(keyPath, 'utf-8');

  // Sanitize CN for filename (replace special chars with underscores)
  const safeFilename = commonName.replace(/[^a-zA-Z0-9.-]/g, '_');

  try {
    const transporter = createMailTransporter();
    const config = getMailConfig();

    const html = buildDeliveryEmail(commonName, requestedBy);

    await transporter.sendMail({
      from: config.from,
      to: recipients.join(', '),
      subject: `Certificate Issued: ${commonName}`,
      html,
      attachments: [
        {
          filename: `${safeFilename}.cer`,
          content: certPEM,
          contentType: 'application/x-x509-ca-cert',
        },
        {
          filename: `${safeFilename}.key`,
          content: keyPEM,
          contentType: 'application/x-pem-file',
        },
      ],
    });

    logger.info(`Certificate for ${commonName} delivered to ${recipients.join(', ')}`);

    // Delete private key immediately after successful email delivery
    const deleted = deletePrivateKey(keyPath);
    if (!deleted) {
      logger.warn(`Failed to delete private key after delivery for CSR ${csrId} — manual cleanup required`);
    }

    return { success: true };
  } catch (err: any) {
    logger.error(`Certificate delivery failed for ${commonName}: ${err.message}`);
    // Do NOT delete the key on failure — allow retry
    return { success: false, error: err.message };
  }
}

function buildDeliveryEmail(commonName: string, requestedBy: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #1976d2;">Certificate Issued</h2>

      <p>A new SSL/TLS certificate has been issued and is attached to this email.</p>

      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 16px; background: #f5f5f5; font-weight: bold; border: 1px solid #ddd;">Common Name</td>
          <td style="padding: 8px 16px; border: 1px solid #ddd;">${commonName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px; background: #f5f5f5; font-weight: bold; border: 1px solid #ddd;">Requested By</td>
          <td style="padding: 8px 16px; border: 1px solid #ddd;">${requestedBy}</td>
        </tr>
      </table>

      <h3 style="color: #333;">Attachments</h3>
      <ul>
        <li><strong>.cer</strong> — The signed certificate. Install this on your web server.</li>
        <li><strong>.key</strong> — The private key. Store this securely and never share it.</li>
      </ul>

      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px; margin: 16px 0;">
        <strong>⚠ Security Notice:</strong> The private key attached to this email is the only copy.
        It has been permanently deleted from the CertManager server. Store it securely and do not
        forward this email.
      </div>

      <h3 style="color: #333;">Apache Installation</h3>
      <p>Add the following to your Apache virtual host configuration:</p>
      <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 13px;">
SSLCertificateFile    /path/to/${commonName}.cer
SSLCertificateKeyFile /path/to/${commonName}.key</pre>

      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        This is an automated message from Certificate Manager.
      </p>
    </body>
    </html>
  `;
}