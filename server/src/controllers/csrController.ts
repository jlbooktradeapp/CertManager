import { Request, Response } from 'express';
import { CSRRequest } from '../models/CSRRequest';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { Server } from '../models/Server';
import { executePowerShell, submitCSR, validateHostname, sanitizePSString } from '../services/powershellService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

// Validate and sanitize certificate subject fields (prevent INF/PS injection)
const SAFE_SUBJECT_REGEX = /^[a-zA-Z0-9 .,_@()-]+$/;
const SAFE_HASH_ALGORITHMS = new Set(['SHA256', 'SHA384', 'SHA512', 'SHA1']);
const VALID_KEY_SIZES = new Set([2048, 4096]);

function validateSubjectField(value: string): boolean {
  return SAFE_SUBJECT_REGEX.test(value) && value.length <= 200;
}

function validateSAN(san: string): boolean {
  // SANs should be valid DNS names, IPs, or email addresses
  return /^[a-zA-Z0-9.*@_-]+(\.[a-zA-Z0-9*_-]+)*$/.test(san) && san.length <= 253;
}

export async function listCSRs(req: Request, res: Response): Promise<void> {
  try {
    const { status, page = '1', limit = '25' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: Record<string, any> = {};
    if (status) {
      query.status = status;
    }

    const [csrs, total] = await Promise.all([
      CSRRequest.find(query)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('targetCAId', 'name displayName')
        .populate('targetServerId', 'hostname fqdn'),
      CSRRequest.countDocuments(query),
    ]);

    res.json({
      data: csrs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('List CSRs error:', error);
    res.status(500).json({ error: 'Failed to list CSR requests' });
  }
}

export async function getCSR(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id)
      .populate('targetCAId', 'name displayName hostname configString')
      .populate('targetServerId', 'hostname fqdn')
      .populate('issuedCertificateId');

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    res.json(csr);
  } catch (error) {
    logger.error('Get CSR error:', error);
    res.status(500).json({ error: 'Failed to get CSR request' });
  }
}

export async function createCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      commonName,
      subjectAlternativeNames = [],
      subject = {},
      keySize = 2048,
      keyAlgorithm = 'RSA',
      hashAlgorithm = 'SHA256',
      templateName,
      targetCAId,
      targetServerId,
    } = req.body;

    if (!commonName) {
      res.status(400).json({ error: 'Common name is required' });
      return;
    }

    // Validate CA if provided
    if (targetCAId) {
      const ca = await CertificateAuthority.findById(targetCAId);
      if (!ca) {
        res.status(400).json({ error: 'Invalid certificate authority' });
        return;
      }
    }

    // Validate server if provided
    if (targetServerId) {
      const server = await Server.findById(targetServerId);
      if (!server) {
        res.status(400).json({ error: 'Invalid target server' });
        return;
      }
    }

    const csr = await CSRRequest.create({
      commonName,
      subjectAlternativeNames,
      subject,
      keySize,
      keyAlgorithm,
      hashAlgorithm,
      templateName,
      targetCAId,
      targetServerId,
      status: 'draft',
      requestedBy: req.user?.username || 'unknown',
      requestedAt: new Date(),
      workflowSteps: [
        { step: 'Generate CSR', status: 'pending' },
        { step: 'Submit to CA', status: 'pending' },
        { step: 'Install Certificate', status: 'pending' },
      ],
    });

    logger.info(`CSR request created for ${commonName} by ${req.user?.username}`);

    res.status(201).json(csr);
  } catch (error) {
    logger.error('Create CSR error:', error);
    res.status(500).json({ error: 'Failed to create CSR request' });
  }
}

export async function updateCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const updates = req.body;

    const csr = await CSRRequest.findById(id);

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    // Only allow updates to draft CSRs
    if (csr.status !== 'draft') {
      res.status(400).json({ error: 'Can only update draft CSR requests' });
      return;
    }

    // Whitelist allowed fields to prevent mass assignment
    const allowedFields = ['commonName', 'subjectAlternativeNames', 'subject', 'keySize', 'keyAlgorithm', 'hashAlgorithm', 'templateName', 'targetCAId', 'targetServerId'] as const;
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        (csr as any)[field] = req.body[field];
      }
    }
    await csr.save();

    logger.info(`CSR request ${id} updated by ${req.user?.username}`);

    res.json(csr);
  } catch (error) {
    logger.error('Update CSR error:', error);
    res.status(500).json({ error: 'Failed to update CSR request' });
  }
}

export async function generateCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id)
      .populate('targetServerId');

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status !== 'draft' && csr.status !== 'pending') {
      res.status(400).json({ error: 'CSR already generated or processed' });
      return;
    }

    // Validate all user-supplied values before building INF content
    if (!validateSubjectField(csr.commonName)) {
      res.status(400).json({ error: 'Invalid common name: contains disallowed characters' });
      return;
    }

    if (!SAFE_HASH_ALGORITHMS.has(csr.hashAlgorithm)) {
      res.status(400).json({ error: `Invalid hash algorithm. Allowed: ${[...SAFE_HASH_ALGORITHMS].join(', ')}` });
      return;
    }

    if (!VALID_KEY_SIZES.has(csr.keySize)) {
      res.status(400).json({ error: `Invalid key size. Allowed: ${[...VALID_KEY_SIZES].join(', ')}` });
      return;
    }

    // Validate subject fields
    const subjectFields = ['organization', 'organizationalUnit', 'locality', 'state', 'country'] as const;
    const subject = csr.subject as Record<string, string | undefined>;
    for (const field of subjectFields) {
      if (subject[field] && !validateSubjectField(subject[field]!)) {
        res.status(400).json({ error: `Invalid subject field '${field}': contains disallowed characters` });
        return;
      }
    }

    // Validate SANs
    for (const san of csr.subjectAlternativeNames) {
      if (!validateSAN(san)) {
        res.status(400).json({ error: `Invalid SAN '${san}': must be a valid DNS name` });
        return;
      }
    }

    csr.status = 'pending';
    updateWorkflowStep(csr, 'Generate CSR', 'pending');
    await csr.save();

    // Build INF file content (all values validated above)
    const sans = csr.subjectAlternativeNames.map((san, i) => `DNS.${i + 1}=${san}`).join('\n');
    const subjectLine = buildSubjectLine(csr);

    const infContent = `
[Version]
Signature="$Windows NT$"

[NewRequest]
Subject = "${subjectLine}"
KeySpec = 1
KeyLength = ${csr.keySize}
Exportable = TRUE
MachineKeySet = TRUE
SMIME = FALSE
PrivateKeyArchive = FALSE
UserProtected = FALSE
UseExistingKeySet = FALSE
ProviderName = "Microsoft RSA SChannel Cryptographic Provider"
ProviderType = 12
RequestType = PKCS10
KeyUsage = 0xa0
HashAlgorithm = ${csr.hashAlgorithm}

[EnhancedKeyUsageExtension]
OID=1.3.6.1.5.5.7.3.1

${sans ? `[Extensions]\n2.5.29.17 = "{text}"\n_continue_ = "${sans.replace(/\n/g, '&')}"` : ''}
`.trim();

    const targetServer = csr.targetServerId as any;
    const computerName = targetServer?.fqdn || 'localhost';

    // Validate remote computer name if not localhost
    if (computerName !== 'localhost' && !validateHostname(computerName)) {
      res.status(400).json({ error: 'Invalid target server hostname' });
      return;
    }

    // Use the CSR's MongoDB ObjectId (safe hex string) for temp file naming
    const safeId = String(csr._id);
    const result = await executePowerShell({
      script: `
        $infContent = @'
${infContent}
'@
        $infPath = Join-Path $env:TEMP '${safeId}.inf'
        $csrPath = Join-Path $env:TEMP '${safeId}.csr'

        $infContent | Out-File -FilePath $infPath -Encoding ASCII

        certreq -new $infPath $csrPath

        if (Test-Path $csrPath) {
          Get-Content $csrPath -Raw
        } else {
          throw "CSR generation failed"
        }
      `,
      remoteComputer: computerName !== 'localhost' ? computerName : undefined,
    });

    if (result.success) {
      csr.csrPEM = result.output;
      csr.privateKeyLocation = `${computerName}:LocalMachine\\My`;
      updateWorkflowStep(csr, 'Generate CSR', 'completed');
      await csr.save();

      logger.info(`CSR generated for ${csr.commonName} by ${req.user?.username}`);
      res.json({ message: 'CSR generated successfully', csrPEM: result.output });
    } else {
      csr.errorMessage = result.error;
      updateWorkflowStep(csr, 'Generate CSR', 'failed', result.error);
      csr.status = 'failed';
      await csr.save();

      res.status(500).json({ error: 'Failed to generate CSR', details: result.error });
    }
  } catch (error) {
    logger.error('Generate CSR error:', error);
    res.status(500).json({ error: 'Failed to generate CSR' });
  }
}

export async function submitCSRToCA(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id)
      .populate('targetCAId');

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (!csr.csrPEM) {
      res.status(400).json({ error: 'CSR must be generated first' });
      return;
    }

    if (!csr.targetCAId) {
      res.status(400).json({ error: 'Target CA must be specified' });
      return;
    }

    const ca = csr.targetCAId as any;

    csr.status = 'submitted';
    updateWorkflowStep(csr, 'Submit to CA', 'pending');
    await csr.save();

    const result = await submitCSR(
      `${process.env.TEMP || '/tmp'}/${csr._id}.csr`,
      ca.configString,
      csr.templateName || 'WebServer'
    );

    if (result.success) {
      updateWorkflowStep(csr, 'Submit to CA', 'completed');
      csr.processedAt = new Date();
      // In a real implementation, we would parse the issued certificate
      // and create a Certificate record
      await csr.save();

      logger.info(`CSR submitted to CA for ${csr.commonName} by ${req.user?.username}`);
      res.json({ message: 'CSR submitted successfully' });
    } else {
      csr.errorMessage = result.error;
      updateWorkflowStep(csr, 'Submit to CA', 'failed', result.error);
      csr.status = 'failed';
      await csr.save();

      res.status(500).json({ error: 'Failed to submit CSR', details: result.error });
    }
  } catch (error) {
    logger.error('Submit CSR error:', error);
    res.status(500).json({ error: 'Failed to submit CSR' });
  }
}

export async function deleteCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id);

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status === 'submitted') {
      res.status(400).json({ error: 'Cannot delete submitted CSR' });
      return;
    }

    await csr.deleteOne();

    logger.info(`CSR request for ${csr.commonName} deleted by ${req.user?.username}`);

    res.json({ message: 'CSR request deleted' });
  } catch (error) {
    logger.error('Delete CSR error:', error);
    res.status(500).json({ error: 'Failed to delete CSR request' });
  }
}

function buildSubjectLine(csr: any): string {
  const parts: string[] = [`CN=${csr.commonName}`];

  if (csr.subject.organization) parts.push(`O=${csr.subject.organization}`);
  if (csr.subject.organizationalUnit) parts.push(`OU=${csr.subject.organizationalUnit}`);
  if (csr.subject.locality) parts.push(`L=${csr.subject.locality}`);
  if (csr.subject.state) parts.push(`S=${csr.subject.state}`);
  if (csr.subject.country) parts.push(`C=${csr.subject.country}`);

  return parts.join(', ');
}

function updateWorkflowStep(
  csr: any,
  stepName: string,
  status: 'pending' | 'completed' | 'failed',
  error?: string
): void {
  const step = csr.workflowSteps.find((s: any) => s.step === stepName);
  if (step) {
    step.status = status;
    if (status === 'completed') {
      step.completedAt = new Date();
    }
    if (error) {
      step.error = error;
    }
  }
}
