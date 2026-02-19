import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import path from 'path';

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
const SAFE_CONFIG_STRING_REGEX = /^[a-zA-Z0-9._\\-]+$/;

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

    args.push('-Command', command);

    logger.debug('Executing PowerShell command', { scriptFile: scriptFile || '(inline)' });

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
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        logger.error(`PowerShell error (code ${code}): ${stderr}`);
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() });
      }
    });

    ps.on('error', (err) => {
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

export async function getCAIssuedCertificates(configString: string): Promise<PowerShellResult> {
  if (!validateConfigString(configString)) {
    return { success: false, output: '', error: 'Invalid CA config string' };
  }
  return executePowerShell({
    scriptFile: 'Get-IssuedCertificates.ps1',
    parameters: { ConfigString: configString },
    timeout: 120000,
  });
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
