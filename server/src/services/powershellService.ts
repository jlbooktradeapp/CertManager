import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface PowerShellResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface PowerShellOptions {
  script?: string;
  scriptFile?: string;
  parameters?: Record<string, string | number | boolean>;
  timeout?: number;
  remoteComputer?: string;
}

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

// Allowed script files to prevent path traversal
const ALLOWED_SCRIPTS = new Set([
  'Bind-IISCertificate.ps1',
  'Get-CAInfo.ps1',
  'Get-IssuedCertificates.ps1',
  'Install-Certificate.ps1',
  'New-CertificateRequest.ps1',
  'Revoke-Certificate.ps1',
  'Submit-CertificateRequest.ps1',
]);

// Sanitize a string value for safe use in PowerShell single-quoted strings.
// In PS single-quoted strings, the only escape is '' for a literal single quote.
function sanitizePSString(value: string): string {
  return value.replace(/'/g, "''");
}

// Validate that a value contains only safe characters for hostnames/FQDN
const SAFE_HOSTNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

function validateHostname(hostname: string): boolean {
  return SAFE_HOSTNAME_REGEX.test(hostname) && hostname.length <= 253;
}

// Validate that a value contains only safe characters for a CA config string (hostname\CAName)
const SAFE_CONFIG_STRING_REGEX = /^[a-zA-Z0-9._ \\-]+$/;

function validateConfigString(value: string): boolean {
  return SAFE_CONFIG_STRING_REGEX.test(value) && value.length <= 500;
}

// Validate PowerShell parameter keys (must be alphanumeric)
const SAFE_PARAM_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;

export async function executePowerShell(options: PowerShellOptions): Promise<PowerShellResult> {
  const { script, scriptFile, parameters = {}, timeout = 60000, remoteComputer } = options;

  return new Promise((resolve) => {
    const args: string[] = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
    ];

    let command: string;

    if (scriptFile) {
      // Validate against allowlist to prevent path traversal
      if (!ALLOWED_SCRIPTS.has(scriptFile)) {
        resolve({ success: false, output: '', error: `Script not allowed: ${scriptFile}` });
        return;
      }
      const fullPath = path.join(SCRIPTS_DIR, scriptFile);
      // Verify the resolved path is still within SCRIPTS_DIR
      const resolvedPath = path.resolve(fullPath);
      const resolvedScriptsDir = path.resolve(SCRIPTS_DIR);
      if (!resolvedPath.startsWith(resolvedScriptsDir)) {
        resolve({ success: false, output: '', error: 'Invalid script path' });
        return;
      }
      command = `& '${sanitizePSString(fullPath)}'`;
    } else if (script) {
      command = script;
    } else {
      resolve({ success: false, output: '', error: 'No script or scriptFile provided' });
      return;
    }

    // Add parameters using single-quoted strings for safety
    const paramStrings = Object.entries(parameters).map(([key, value]) => {
      if (!SAFE_PARAM_KEY_REGEX.test(key)) {
        throw new Error(`Invalid parameter key: ${key}`);
      }
      if (typeof value === 'boolean') {
        return value ? `-${key}` : '';
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid numeric parameter: ${key}`);
        }
        return `-${key} ${value}`;
      }
      // Use single-quoted strings to prevent variable expansion and injection
      return `-${key} '${sanitizePSString(String(value))}'`;
    }).filter(Boolean);

    if (paramStrings.length > 0) {
      command += ' ' + paramStrings.join(' ');
    }

    // Wrap in remote execution if needed
    if (remoteComputer) {
      if (!validateHostname(remoteComputer)) {
        resolve({ success: false, output: '', error: 'Invalid remote computer name' });
        return;
      }
      command = `Invoke-Command -ComputerName '${sanitizePSString(remoteComputer)}' -ScriptBlock { ${command} }`;
    }

    // For complex commands (multi-line or remote), write to a temp .ps1 file
    // and run with -File instead of -Command. This avoids PowerShell's -Command
    // string parser mangling multi-line scripts, here-strings, and nested braces.
    let tempScriptPath: string | null = null;
    const isComplexCommand = command.includes('\n') || remoteComputer;

    if (isComplexCommand) {
      tempScriptPath = path.join(os.tmpdir(), `certmgr-ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
      try {
        fs.writeFileSync(tempScriptPath, command, 'utf-8');
      } catch (writeErr: any) {
        resolve({ success: false, output: '', error: `Failed to write temp script: ${writeErr.message}` });
        return;
      }
      args.push('-File', tempScriptPath);
    } else {
      args.push('-Command', command);
    }

    logger.debug('Executing PowerShell command', { scriptFile: scriptFile || '(inline)', remote: !!remoteComputer, tempFile: !!tempScriptPath });

    const ps = spawn('powershell.exe', args, {
      windowsHide: true,
      timeout,
    });

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ps.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ps.on('close', (code) => {
      // Clean up temp script file
      if (tempScriptPath) {
        try { fs.unlinkSync(tempScriptPath); } catch {}
      }

      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        logger.error(`PowerShell error (code ${code}): ${stderr}`);
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() });
      }
    });

    ps.on('error', (err) => {
      // Clean up temp script file
      if (tempScriptPath) {
        try { fs.unlinkSync(tempScriptPath); } catch {}
      }

      logger.error('PowerShell spawn error:', err);
      resolve({ success: false, output: '', error: err.message });
    });
  });
}

export async function testConnection(hostname: string): Promise<boolean> {
  if (!validateHostname(hostname)) {
    return false;
  }
  const result = await executePowerShell({
    script: `Test-Connection -ComputerName '${sanitizePSString(hostname)}' -Count 1 -Quiet`,
    timeout: 10000,
  });

  return result.success && result.output.toLowerCase() === 'true';
}

export async function testWinRM(hostname: string): Promise<boolean> {
  if (!validateHostname(hostname)) {
    return false;
  }
  const result = await executePowerShell({
    script: `Test-WSMan -ComputerName '${sanitizePSString(hostname)}' -ErrorAction SilentlyContinue | Out-Null; $?`,
    timeout: 15000,
  });

  return result.success && result.output.toLowerCase() === 'true';
}

export async function getRemoteCertificates(hostname: string): Promise<PowerShellResult> {
  if (!validateHostname(hostname)) {
    return { success: false, output: '', error: 'Invalid hostname' };
  }
  return executePowerShell({
    script: `
      Invoke-Command -ComputerName '${sanitizePSString(hostname)}' -ScriptBlock {
        Get-ChildItem -Path Cert:\\LocalMachine\\My |
        Select-Object Thumbprint, Subject, NotBefore, NotAfter, Issuer |
        ConvertTo-Json -Compress
      }
    `,
    timeout: 30000,
  });
}

// Replace the getCAIssuedCertificates function in powershellService.ts with this:

export interface SyncResult extends PowerShellResult {
  lastRequestID?: number;
}

export async function getCAIssuedCertificates(
  configString: string,
  options?: {
    sinceDate?: string;
    startRequestID?: number;
    maxExpirationYears?: number;
  }
): Promise<SyncResult> {
  if (!validateConfigString(configString)) {
    return { success: false, output: '', error: 'Invalid CA config string' };
  }

  // Use a temp file to avoid Node.js string length limits on large CAs
  const os = await import('os');
  const fs = await import('fs');
  const tempFile = path.join(os.tmpdir(), `certmanager-sync-${Date.now()}.json`);

  const parameters: Record<string, string> = {
    ConfigString: configString,
    OutputFile: tempFile,
  };

  // Incremental sync via RequestID watermark (preferred)
  if (options?.startRequestID && options.startRequestID > 0) {
    parameters.StartRequestID = options.startRequestID.toString();
    logger.info(`CA sync mode: incremental (RequestID > ${options.startRequestID})`);
  }
  // Legacy incremental via SinceDate (backward compatible)
  else if (options?.sinceDate) {
    parameters.SinceDate = options.sinceDate;
    logger.info(`CA sync mode: legacy (NotAfter >= ${options.sinceDate})`);
  }
  // Full sync with expiration window
  else {
    const years = options?.maxExpirationYears ?? 2;
    parameters.MaxExpirationYears = years.toString();
    logger.info(`CA sync mode: full (${years}-year expiration window)`);
  }

  logger.info(`CA sync temp file: ${tempFile}`);

  const result = await executePowerShell({
    scriptFile: 'Get-IssuedCertificates.ps1',
    parameters,
    timeout: 14400000, // 4 hours for very large CAs with batched processing
  });

  logger.info(`CA sync PS result - success: ${result.success}, output length: ${result.output?.length || 0}, error: ${result.error || 'none'}`);

  if (!result.success) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tempFile); } catch {}
    return result;
  }

  // Parse stdout lines — may contain FILE:{path} and LASTID:{number}
  const outputLines = result.output.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let lastRequestID: number | undefined;
  let fileLine: string | undefined;

  for (const line of outputLines) {
    if (line.startsWith('LASTID:')) {
      lastRequestID = parseInt(line.replace('LASTID:', ''), 10);
      if (isNaN(lastRequestID)) lastRequestID = undefined;
    } else if (line.startsWith('FILE:')) {
      fileLine = line.replace('FILE:', '');
    }
  }

  if (lastRequestID) {
    logger.info(`CA sync last RequestID: ${lastRequestID}`);
  }

  // If PowerShell wrote to the temp file, read it back
  const fileToRead = fileLine || tempFile;

  try {
    if (fs.existsSync(fileToRead)) {
      const fileStats = fs.statSync(fileToRead);
      logger.info(`CA sync output file size: ${(fileStats.size / 1024 / 1024).toFixed(1)} MB`);

      if (fileStats.size === 0) {
        fs.unlinkSync(fileToRead);
        return { success: true, output: '[]', lastRequestID };
      }

      const data = fs.readFileSync(fileToRead, 'utf-8');
      fs.unlinkSync(fileToRead); // Clean up temp file
      return { success: true, output: data, lastRequestID };
    }
  } catch (err: any) {
    logger.error(`Failed to read sync output file ${fileToRead}: ${err.message}`);
    return { success: false, output: '', error: `Failed to read sync output file: ${err.message}` };
  }

  // Clean up temp file if it's different from fileToRead
  if (fileLine && fileLine !== tempFile) {
    try { fs.unlinkSync(tempFile); } catch {}
  }

  // Fallback: return raw stdout (works for small CAs)
  // Filter out our metadata lines from the output
  const jsonOutput = outputLines.filter(l => !l.startsWith('FILE:') && !l.startsWith('LASTID:')).join('\n');
  logger.info(`CA sync falling back to stdout output (length: ${jsonOutput?.length || 0})`);
  return { success: true, output: jsonOutput || '[]', lastRequestID };
}

export async function submitCSR(
  csrPath: string,
  configString: string,
  template: string
): Promise<PowerShellResult> {
  if (!validateConfigString(configString)) {
    return { success: false, output: '', error: 'Invalid CA config string' };
  }
  // Validate template name (alphanumeric, hyphens, spaces only)
  if (!/^[a-zA-Z0-9 _-]+$/.test(template)) {
    return { success: false, output: '', error: 'Invalid template name' };
  }
  return executePowerShell({
    scriptFile: 'Submit-CertificateRequest.ps1',
    parameters: {
      CSRPath: csrPath,
      ConfigString: configString,
      Template: template,
    },
    timeout: 60000,
  });
}

export async function installCertificate(
  hostname: string,
  certPath: string
): Promise<PowerShellResult> {
  if (!validateHostname(hostname)) {
    return { success: false, output: '', error: 'Invalid hostname' };
  }
  return executePowerShell({
    scriptFile: 'Install-Certificate.ps1',
    parameters: {
      ComputerName: hostname,
      CertificatePath: certPath,
    },
    timeout: 60000,
  });
}

export async function bindIISCertificate(
  hostname: string,
  siteName: string,
  thumbprint: string,
  port: number = 443
): Promise<PowerShellResult> {
  if (!validateHostname(hostname)) {
    return { success: false, output: '', error: 'Invalid hostname' };
  }
  // Validate thumbprint (hex characters only)
  if (!/^[a-fA-F0-9]+$/.test(thumbprint)) {
    return { success: false, output: '', error: 'Invalid certificate thumbprint' };
  }
  return executePowerShell({
    scriptFile: 'Bind-IISCertificate.ps1',
    parameters: {
      ComputerName: hostname,
      SiteName: siteName,
      Thumbprint: thumbprint,
      Port: port,
    },
    timeout: 60000,
  });
}

// Export validators for use in controllers
export { validateHostname, validateConfigString, sanitizePSString };

export async function revokeCertificate(configString: string, serialNumber: string): Promise<PowerShellResult> {
  if (!validateConfigString(configString)) {
    return { success: false, output: '', error: 'Invalid CA config string' };
  }
  // Validate serial number (hex characters and optional spaces/colons)
  if (!/^[a-fA-F0-9\s:]+$/.test(serialNumber)) {
    return { success: false, output: '', error: 'Invalid serial number' };
  }

  return executePowerShell({
    scriptFile: 'Revoke-Certificate.ps1',
    parameters: {
      ConfigString: configString,
      SerialNumber: serialNumber,
    },
    timeout: 30000,
  });
}