import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { createMailTransporter, getMailConfig } from '../config/mail';
import { deletePrivateKey, getKeyPath } from './opensslService';
import { logger } from '../utils/logger';

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

/**
 * Deliver an Apache certificate via email.
 * Zips the signed certificate (.cer) and private key (.key) into a single .zip
 * attachment to avoid email filter blocking, then deletes the private key from disk.
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

    // Zip the .cer and .key files to avoid email filter blocking
    const zip = new AdmZip();
    zip.addFile(`${safeFilename}.cer`, Buffer.from(certPEM, 'utf-8'));
    zip.addFile(`${safeFilename}.key`, Buffer.from(keyPEM, 'utf-8'));
    const zipBuffer = zip.toBuffer();

    await transporter.sendMail({
      from: config.from,
      to: recipients.join(', '),
      subject: `Certificate Issued: ${commonName}`,
      html,
      attachments: [
        {
          filename: `${safeFilename}.zip`,
          content: zipBuffer,
          contentType: 'application/zip',
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

// SEC-018: Escape HTML special characters to prevent injection in email templates
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDeliveryEmail(commonName: string, requestedBy: string): string {
  const safeCN = escapeHtml(commonName);
  const safeRequester = escapeHtml(requestedBy);
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #1976d2;">Certificate Issued</h2>

      <p>A new SSL/TLS certificate has been issued and is attached to this email.</p>

      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 16px; background: #f5f5f5; font-weight: bold; border: 1px solid #ddd;">Common Name</td>
          <td style="padding: 8px 16px; border: 1px solid #ddd;">${safeCN}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px; background: #f5f5f5; font-weight: bold; border: 1px solid #ddd;">Requested By</td>
          <td style="padding: 8px 16px; border: 1px solid #ddd;">${safeRequester}</td>
        </tr>
      </table>

      <h3 style="color: #333;">Attachment</h3>
      <p>The attached .zip file contains:</p>
      <ul>
        <li><strong>.cer</strong> — The signed certificate. Install this on your web server.</li>
        <li><strong>.key</strong> — The private key. Store this securely and never share it.</li>
      </ul>

      <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px; margin: 16px 0;">
        <strong>⚠ Security Notice:</strong> The private key included in this zip is the only copy.
        It has been permanently deleted from the CertManager server. Store it securely and do not
        forward this email.
      </div>

      <h3 style="color: #333;">Apache Installation</h3>
      <p>Extract the zip and add the following to your Apache virtual host configuration:</p>
      <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 13px;">
SSLCertificateFile    /path/to/${safeCN}.cer
SSLCertificateKeyFile /path/to/${safeCN}.key</pre>

      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        This is an automated message from Certificate Manager.
      </p>

      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        tuhsencryptedmessage
      </p>
    </body>
    </html>
  `;
}