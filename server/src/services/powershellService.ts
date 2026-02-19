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
      const fullPath = path.join(SCRIPTS_DIR, scriptFile);
      command = `& '${fullPath}'`;
    } else if (script) {
      command = script;
    } else {
      resolve({ success: false, output: '', error: 'No script or scriptFile provided' });
      return;
    }

    // Add parameters
    const paramStrings = Object.entries(parameters).map(([key, value]) => {
      if (typeof value === 'boolean') {
        return value ? `-${key}` : '';
      }
      if (typeof value === 'string' && value.includes(' ')) {
        return `-${key} "${value}"`;
      }
      return `-${key} ${value}`;
    }).filter(Boolean);

    if (paramStrings.length > 0) {
      command += ' ' + paramStrings.join(' ');
    }

    // Wrap in remote execution if needed
    if (remoteComputer) {
      command = `Invoke-Command -ComputerName ${remoteComputer} -ScriptBlock { ${command} }`;
    }

    args.push('-Command', command);

    logger.debug(`Executing PowerShell: ${command}`);

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
  const result = await executePowerShell({
    script: `Test-Connection -ComputerName "${hostname}" -Count 1 -Quiet`,
    timeout: 10000,
  });

  return result.success && result.output.toLowerCase() === 'true';
}

export async function testWinRM(hostname: string): Promise<boolean> {
  const result = await executePowerShell({
    script: `Test-WSMan -ComputerName "${hostname}" -ErrorAction SilentlyContinue | Out-Null; $?`,
    timeout: 15000,
  });

  return result.success && result.output.toLowerCase() === 'true';
}

export async function getRemoteCertificates(hostname: string): Promise<PowerShellResult> {
  return executePowerShell({
    script: `
      Invoke-Command -ComputerName "${hostname}" -ScriptBlock {
        Get-ChildItem -Path Cert:\\LocalMachine\\My |
        Select-Object Thumbprint, Subject, NotBefore, NotAfter, Issuer |
        ConvertTo-Json -Compress
      }
    `,
    timeout: 30000,
  });
}

export async function getCAIssuedCertificates(configString: string): Promise<PowerShellResult> {
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
