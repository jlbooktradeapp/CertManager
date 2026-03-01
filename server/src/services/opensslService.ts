import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface OpenSSLResult {
  success: boolean;
  csrPEM?: string;
  keyPath?: string;
  csrPath?: string;
  error?: string;
}

export interface OpenSSLCSROptions {
  id: string;          // CSRRequest ObjectId — used for temp file naming
  commonName: string;
  subjectAlternativeNames: string[];
  subject: {
    organization?: string;
    organizationalUnit?: string;
    locality?: string;
    state?: string;
    country?: string;
  };
  keySize: number;
  hashAlgorithm: string;
}

/**
 * Generate a CSR and private key using OpenSSL.
 * Files are written to os.tmpdir() with the CSRRequest ObjectId as prefix.
 * The caller is responsible for cleaning up the key file after delivery.
 */
export async function generateOpenSSLCSR(options: OpenSSLCSROptions): Promise<OpenSSLResult> {
  const { id, commonName, subjectAlternativeNames, subject, keySize, hashAlgorithm } = options;

  const tmpDir = os.tmpdir();
  const confPath = path.join(tmpDir, `${id}.cnf`);
  const keyPath = path.join(tmpDir, `${id}.key`);
  const csrPath = path.join(tmpDir, `${id}.csr`);

  // Build the subject line
  const subjectParts: string[] = [];
  if (subject.country) subjectParts.push(`/C=${subject.country}`);
  if (subject.state) subjectParts.push(`/ST=${subject.state}`);
  if (subject.locality) subjectParts.push(`/L=${subject.locality}`);
  if (subject.organization) subjectParts.push(`/O=${subject.organization}`);
  if (subject.organizationalUnit) subjectParts.push(`/OU=${subject.organizationalUnit}`);
  subjectParts.push(`/CN=${commonName}`);
  const subjectLine = subjectParts.join('');

  // Build OpenSSL config file with SAN support
  const allSANs = [commonName, ...subjectAlternativeNames];
  const uniqueSANs = [...new Set(allSANs)];
  const sanEntries = uniqueSANs.map((san, i) => `DNS.${i + 1} = ${san}`).join('\n');

  // Map hash algorithm to OpenSSL digest name
  const digestMap: Record<string, string> = {
    'SHA256': 'sha256',
    'SHA384': 'sha384',
    'SHA512': 'sha512',
  };
  const digest = digestMap[hashAlgorithm] || 'sha256';

  const confContent = `[req]
default_bits = ${keySize}
prompt = no
default_md = ${digest}
distinguished_name = dn
req_extensions = v3_req

[dn]
${subject.country ? `C = ${subject.country}` : ''}
${subject.state ? `ST = ${subject.state}` : ''}
${subject.locality ? `L = ${subject.locality}` : ''}
${subject.organization ? `O = ${subject.organization}` : ''}
${subject.organizationalUnit ? `OU = ${subject.organizationalUnit}` : ''}
CN = ${commonName}

[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${sanEntries}
`;

  try {
    // Write config file
    fs.writeFileSync(confPath, confContent, 'utf-8');

    // Run openssl to generate key + CSR
    const result = await runOpenSSL([
      'req', '-new', '-newkey', `rsa:${keySize}`,
      '-nodes',
      '-keyout', keyPath,
      '-out', csrPath,
      '-config', confPath,
    ]);

    // Clean up config file (no longer needed)
    safeDelete(confPath);

    if (!result.success) {
      safeDelete(keyPath);
      safeDelete(csrPath);
      return { success: false, error: result.error };
    }

    // Verify both files exist
    if (!fs.existsSync(csrPath) || !fs.existsSync(keyPath)) {
      safeDelete(keyPath);
      safeDelete(csrPath);
      return { success: false, error: 'OpenSSL did not produce expected output files' };
    }

    const csrPEM = fs.readFileSync(csrPath, 'utf-8');

    logger.info(`OpenSSL CSR generated for ${commonName} (key: ${keyPath})`);

    return {
      success: true,
      csrPEM,
      keyPath,
      csrPath,
    };
  } catch (err: any) {
    logger.error(`OpenSSL CSR generation error: ${err.message}`);
    // Clean up on error
    safeDelete(confPath);
    safeDelete(keyPath);
    safeDelete(csrPath);
    return { success: false, error: err.message };
  }
}

/**
 * Delete the private key file from disk.
 * Called after successful email delivery.
 */
export function deletePrivateKey(keyPath: string): boolean {
  try {
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
      logger.info(`Private key deleted: ${keyPath}`);
      return true;
    }
    return false;
  } catch (err: any) {
    logger.error(`Failed to delete private key ${keyPath}: ${err.message}`);
    return false;
  }
}

/**
 * Get the key path for a CSR request (predictable location based on ObjectId).
 */
export function getKeyPath(csrId: string): string {
  return path.join(os.tmpdir(), `${csrId}.key`);
}

/**
 * Get the CSR file path for a CSR request.
 */
export function getCSRPath(csrId: string): string {
  return path.join(os.tmpdir(), `${csrId}.csr`);
}

/**
 * Check if a private key file still exists on disk.
 */
export function privateKeyExists(csrId: string): boolean {
  return fs.existsSync(getKeyPath(csrId));
}

function safeDelete(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function runOpenSSL(args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('openssl', args, {
      windowsHide: true,
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // OpenSSL writes informational messages to stderr even on success
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        logger.error(`OpenSSL error (code ${code}): ${stderr}`);
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() });
      }
    });

    proc.on('error', (err) => {
      logger.error('OpenSSL spawn error:', err);
      resolve({ success: false, output: '', error: err.message });
    });
  });
}