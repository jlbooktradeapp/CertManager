import { Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CSRRequest } from '../models/CSRRequest';
import { Certificate } from '../models/Certificate';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { Server } from '../models/Server';
import { executePowerShell, submitCSR, validateHostname, sanitizePSString, validateConfigString } from '../services/powershellService';
import { generateOpenSSLCSR, getKeyPath, getCSRPath } from '../services/opensslService';
import { deliverApacheCertificate } from '../services/csrDeliveryService';
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
  return /^[a-zA-Z0-9.*@_-]+(\.[a-zA-Z0-9*_-]+)*$/.test(san) && san.length <= 253;
}

// ─── LIST / GET / CREATE / UPDATE ───────────────────────────────────────────────

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
      serverType,
      keySize = 2048,
      keyAlgorithm = 'RSA',
      hashAlgorithm = 'SHA256',
      keyUsage = ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage = ['serverAuth', 'clientAuth'],
      templateName,
      targetCAId,
      targetServerId,
      applicationId,
      deliveryEmails = [],
    } = req.body;

    if (!commonName) {
      res.status(400).json({ error: 'Common name is required' });
      return;
    }

    if (!serverType || !['apache', 'iis'].includes(serverType)) {
      res.status(400).json({ error: 'serverType is required and must be "apache" or "iis"' });
      return;
    }

    // Validate CA if provided — must be issuance-enabled
    if (targetCAId) {
      const ca = await CertificateAuthority.findById(targetCAId);
      if (!ca) {
        res.status(400).json({ error: 'Invalid certificate authority' });
        return;
      }
      if (!ca.issuanceEnabled) {
        res.status(400).json({ error: 'Selected CA is not enabled for certificate issuance' });
        return;
      }
    }

    // Validate server if provided (IIS path)
    if (targetServerId) {
      const server = await Server.findById(targetServerId);
      if (!server) {
        res.status(400).json({ error: 'Invalid target server' });
        return;
      }
    }

    // Build workflow steps based on server type
    const workflowSteps = serverType === 'apache'
      ? [
          { step: 'Generate CSR', status: 'pending' as const },
          { step: 'Submit to CA', status: 'pending' as const },
          { step: 'Deliver Certificate', status: 'pending' as const },
        ]
      : [
          { step: 'Generate CSR', status: 'pending' as const },
          { step: 'Submit to CA', status: 'pending' as const },
          { step: 'Install Certificate', status: 'pending' as const },
        ];

    const csr = await CSRRequest.create({
      commonName,
      subjectAlternativeNames,
      subject,
      serverType,
      keySize,
      keyAlgorithm,
      hashAlgorithm,
      keyUsage,
      extendedKeyUsage,
      templateName,
      targetCAId,
      targetServerId: serverType === 'iis' ? targetServerId : undefined,
      applicationId: applicationId || undefined,
      deliveryEmails: serverType === 'apache' ? deliveryEmails : [],
      status: 'draft',
      requestedBy: req.user?.username || 'unknown',
      requestedAt: new Date(),
      workflowSteps,
    });

    logger.info(`CSR request created for ${commonName} (${serverType}) by ${req.user?.username}`);

    res.status(201).json(csr);
  } catch (error) {
    logger.error('Create CSR error:', error);
    res.status(500).json({ error: 'Failed to create CSR request' });
  }
}

export async function updateCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id);

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status !== 'draft') {
      res.status(400).json({ error: 'Can only update draft CSR requests' });
      return;
    }

    const allowedFields = ['commonName', 'subjectAlternativeNames', 'subject', 'keySize', 'keyAlgorithm', 'hashAlgorithm', 'keyUsage', 'extendedKeyUsage', 'templateName', 'targetCAId', 'targetServerId', 'deliveryEmails', 'serverType'] as const;
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

// ─── GENERATE CSR ───────────────────────────────────────────────────────────────

export async function generateCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id)
      .populate('targetServerId');

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status !== 'draft') {
      res.status(400).json({ error: 'CSR already generated or processed' });
      return;
    }

    // ── Common validation ──────────────────────────────────────────────
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

    const subjectFields = ['organization', 'organizationalUnit', 'locality', 'state', 'country'] as const;
    const subject = csr.subject as Record<string, string | undefined>;
    for (const field of subjectFields) {
      if (subject[field] && !validateSubjectField(subject[field]!)) {
        res.status(400).json({ error: `Invalid subject field '${field}': contains disallowed characters` });
        return;
      }
    }

    for (const san of csr.subjectAlternativeNames) {
      if (!validateSAN(san)) {
        res.status(400).json({ error: `Invalid SAN '${san}': must be a valid DNS name` });
        return;
      }
    }

    // Mark as generating
    csr.status = 'generating';
    updateWorkflowStep(csr, 'Generate CSR', 'pending');
    await csr.save();

    // ── Branch by server type ──────────────────────────────────────────
    if (csr.serverType === 'apache') {
      await generateApacheCSR(csr, req, res);
    } else {
      await generateIISCSR(csr, req, res);
    }
  } catch (error) {
    logger.error('Generate CSR error:', error);
    res.status(500).json({ error: 'Failed to generate CSR' });
  }
}

/**
 * Apache path: Generate CSR + private key locally via OpenSSL.
 * Private key remains on disk until delivery.
 */
async function generateApacheCSR(csr: any, req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = await generateOpenSSLCSR({
    id: String(csr._id),
    commonName: csr.commonName,
    subjectAlternativeNames: csr.subjectAlternativeNames,
    subject: csr.subject,
    keySize: csr.keySize,
    hashAlgorithm: csr.hashAlgorithm,
    keyUsage: csr.keyUsage,
    extendedKeyUsage: csr.extendedKeyUsage,
  });

  if (result.success && result.csrPEM) {
    csr.csrPEM = result.csrPEM;
    csr.privateKeyLocation = result.keyPath;
    csr.status = 'pending';
    updateWorkflowStep(csr, 'Generate CSR', 'completed');
    await csr.save();

    logger.info(`Apache CSR generated for ${csr.commonName} by ${req.user?.username}`);
    res.json({ message: 'CSR generated via OpenSSL', csrPEM: result.csrPEM });
  } else {
    csr.errorMessage = result.error;
    csr.status = 'failed';
    updateWorkflowStep(csr, 'Generate CSR', 'failed', result.error);
    await csr.save();

    res.status(500).json({ error: 'OpenSSL CSR generation failed', details: result.error });
  }
}

/**
 * IIS path: Generate CSR on the target server using the IX509Enrollment COM API.
 * This uses the same Microsoft CryptoAPI that certreq.exe wraps internally,
 * but as a direct in-process call — no executable spawning, no console/UI
 * dependency, works reliably in WinRM remote sessions.
 * Private key stays on the target server.
 */
async function generateIISCSR(csr: any, req: AuthenticatedRequest, res: Response): Promise<void> {
  const subjectLine = buildSubjectLine(csr);
  const kuBitmask = buildKeyUsageBitmask(csr.keyUsage || ['digitalSignature', 'keyEncipherment']);
  const ekuOids = buildEKUOids(csr.extendedKeyUsage || ['serverAuth', 'clientAuth']);

  const targetServer = csr.targetServerId as any;
  const computerName = targetServer?.fqdn || 'localhost';

  if (computerName !== 'localhost' && !validateHostname(computerName)) {
    csr.status = 'failed';
    csr.errorMessage = 'Invalid target server hostname';
    updateWorkflowStep(csr, 'Generate CSR', 'failed', 'Invalid target server hostname');
    await csr.save();
    res.status(400).json({ error: 'Invalid target server hostname' });
    return;
  }

  const safeId = String(csr._id);

  // Build SAN and EKU strings to pass into PowerShell
  // Using pipe delimiter since these values can't contain pipes
  const sansJoined = csr.subjectAlternativeNames.join('|');
  const ekuOidsJoined = ekuOids.join('|');

  logger.info(`[IIS-CSR] Starting COM API generation for ${csr.commonName} on ${computerName} (safeId: ${safeId})`);

  const result = await executePowerShell({
    script: `
      Write-Host '[STEP1] Starting IIS CSR generation via COM API'

      # ── Create Private Key ──
      Write-Host '[STEP2] Creating private key...'
      $privateKey = New-Object -ComObject X509Enrollment.CX509PrivateKey
      $privateKey.ProviderName = "Microsoft RSA SChannel Cryptographic Provider"
      $privateKey.KeySpec = 1           # XCN_AT_KEYEXCHANGE
      $privateKey.Length = ${csr.keySize}
      $privateKey.MachineContext = $true
      $privateKey.ExportPolicy = 1      # XCN_NCRYPT_ALLOW_EXPORT_FLAG
      $privateKey.Create()
      Write-Host '[STEP3] Private key created in machine store'

      # ── Create PKCS10 Request ──
      $request = New-Object -ComObject X509Enrollment.CX509CertificateRequestPkcs10
      $request.InitializeFromPrivateKey(2, $privateKey, "")  # 2 = MachineContext
      Write-Host '[STEP4] PKCS10 request initialized'

      # ── Set Subject DN ──
      $dn = New-Object -ComObject X509Enrollment.CX500DistinguishedName
      $dn.Encode('${sanitizePSString(subjectLine)}', 0)  # 0 = XCN_CERT_NAME_STR_NONE
      $request.Subject = $dn
      Write-Host '[STEP5] Subject set: ${sanitizePSString(subjectLine)}'

      # ── Set Subject Alternative Names ──
      $sansStr = '${sanitizePSString(sansJoined)}'
      if ($sansStr -ne '') {
        $sanExt = New-Object -ComObject X509Enrollment.CX509ExtensionAlternativeNames
        $sanNames = New-Object -ComObject X509Enrollment.CAlternativeNames
        foreach ($sanValue in $sansStr.Split('|')) {
          if ($sanValue.Trim() -ne '') {
            $san = New-Object -ComObject X509Enrollment.CAlternativeName
            $san.InitializeFromString(3, $sanValue.Trim())  # 3 = XCN_CERT_ALT_NAME_DNS_STRING
            $sanNames.Add($san)
          }
        }
        if ($sanNames.Count -gt 0) {
          $sanExt.InitializeEncode($sanNames)
          $request.X509Extensions.Add($sanExt)
          Write-Host "[STEP6] SANs added: $($sanNames.Count) entries"
        }
      } else {
        Write-Host '[STEP6] No SANs to add'
      }

      # ── Set Key Usage ──
      $kuExt = New-Object -ComObject X509Enrollment.CX509ExtensionKeyUsage
      $kuExt.InitializeEncode(0x${kuBitmask})
      $kuExt.Critical = $true
      $request.X509Extensions.Add($kuExt)
      Write-Host '[STEP7] Key Usage set: 0x${kuBitmask}'

      # ── Set Enhanced Key Usage ──
      $ekuStr = '${sanitizePSString(ekuOidsJoined)}'
      if ($ekuStr -ne '') {
        $ekuExt = New-Object -ComObject X509Enrollment.CX509ExtensionEnhancedKeyUsage
        $ekuOids = New-Object -ComObject X509Enrollment.CObjectIds
        foreach ($oidValue in $ekuStr.Split('|')) {
          if ($oidValue.Trim() -ne '') {
            $oid = New-Object -ComObject X509Enrollment.CObjectId
            $oid.InitializeFromValue($oidValue.Trim())
            $ekuOids.Add($oid)
          }
        }
        if ($ekuOids.Count -gt 0) {
          $ekuExt.InitializeEncode($ekuOids)
          $request.X509Extensions.Add($ekuExt)
          Write-Host "[STEP8] EKU added: $($ekuOids.Count) OIDs"
        }
      } else {
        Write-Host '[STEP8] No EKU to add'
      }

      # ── Set Hash Algorithm ──
      $hashOid = New-Object -ComObject X509Enrollment.CObjectId
      $hashOid.InitializeFromAlgorithmName(1, 0, 0, '${sanitizePSString(csr.hashAlgorithm)}')
      $request.HashAlgorithm = $hashOid
      Write-Host '[STEP9] Hash algorithm set: ${csr.hashAlgorithm}'

      # ── Create Enrollment and Generate CSR ──
      Write-Host '[STEP10] Creating enrollment and generating CSR...'
      $enrollment = New-Object -ComObject X509Enrollment.CX509Enrollment
      $enrollment.InitializeFromRequest($request)
      $csrText = $enrollment.CreateRequest(3)  # 3 = XCN_CRYPT_STRING_BASE64REQUESTHEADER (PEM)
      Write-Host "[STEP11] CSR generated, length=$($csrText.Length)"

      # Output the CSR PEM
      $csrText
    `,
    remoteComputer: computerName !== 'localhost' ? computerName : undefined,
    timeout: 120000, // 2 minutes — COM API is fast, but allow margin for WinRM
  });

  logger.info(`[IIS-CSR] executePowerShell returned — success: ${result.success}, output length: ${result.output?.length || 0}, error: ${result.error || 'none'}`);

  if (result.success) {
    // Extract just the PEM from the output — Write-Host debug lines are also in stdout
    const csrPEM = extractPEMFromOutput(result.output);
    if (!csrPEM) {
      csr.errorMessage = 'CSR generated but PEM could not be extracted from output';
      csr.status = 'failed';
      updateWorkflowStep(csr, 'Generate CSR', 'failed', 'PEM extraction failed');
      await csr.save();
      logger.error(`[IIS-CSR] PEM extraction failed. Raw output: ${result.output}`);
      res.status(500).json({ error: 'CSR generated but PEM extraction failed' });
      return;
    }

    csr.csrPEM = csrPEM;
    csr.privateKeyLocation = `${computerName}:LocalMachine\\My`;
    csr.status = 'pending';
    updateWorkflowStep(csr, 'Generate CSR', 'completed');
    await csr.save();

    logger.info(`IIS CSR generated for ${csr.commonName} on ${computerName} by ${req.user?.username}`);
    res.json({ message: 'CSR generated successfully', csrPEM });
  } else {
    csr.errorMessage = result.error;
    csr.status = 'failed';
    updateWorkflowStep(csr, 'Generate CSR', 'failed', result.error);
    await csr.save();

    res.status(500).json({ error: 'Failed to generate CSR', details: result.error });
  }
}

// ─── SUBMIT TO CA ───────────────────────────────────────────────────────────────

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

    if (csr.status !== 'pending') {
      res.status(400).json({ error: 'CSR must be in pending status to submit' });
      return;
    }

    if (!csr.targetCAId) {
      res.status(400).json({ error: 'Target CA must be specified' });
      return;
    }

    const ca = csr.targetCAId as any;

    if (!validateConfigString(ca.configString)) {
      res.status(400).json({ error: 'Invalid CA config string' });
      return;
    }

    // Write CSR PEM to a temp file for certreq -submit
    const tmpDir = os.tmpdir();
    const csrTempPath = path.join(tmpDir, `${csr._id}.csr`);
    fs.writeFileSync(csrTempPath, csr.csrPEM, 'utf-8');

    csr.status = 'submitted';
    updateWorkflowStep(csr, 'Submit to CA', 'pending');
    await csr.save();

    const result = await submitCSR(
      csrTempPath,
      ca.configString,
      csr.templateName || 'WebServer'
    );

    // Clean up CSR temp file (not the key — that's needed for Apache delivery)
    try { fs.unlinkSync(csrTempPath); } catch {}

    if (result.success) {
      // Parse the PowerShell JSON output from Submit-CertificateRequest.ps1
      let caResponse: any = {};
      try {
        caResponse = JSON.parse(result.output);
      } catch {
        caResponse = { Success: true, Status: 'Issued', CertificateContent: result.output };
      }

      if (caResponse.Status === 'Issued' && caResponse.CertificateContent) {
        csr.issuedCertPEM = caResponse.CertificateContent;
        csr.issuedThumbprint = caResponse.Thumbprint || undefined;
        csr.issuedSerialNumber = caResponse.SerialNumber || undefined;
        csr.status = 'issued';
        csr.processedAt = new Date();
        updateWorkflowStep(csr, 'Submit to CA', 'completed');
        await csr.save();

        logger.info(`CSR submitted and certificate issued for ${csr.commonName} by ${req.user?.username}`);
        res.json({
          message: 'Certificate issued successfully',
          status: 'issued',
          thumbprint: caResponse.Thumbprint,
          serialNumber: caResponse.SerialNumber,
        });
      } else if (caResponse.Status === 'Pending') {
        csr.status = 'submitted';
        updateWorkflowStep(csr, 'Submit to CA', 'pending');
        await csr.save();

        logger.info(`CSR submitted for ${csr.commonName} — pending CA approval (RequestId: ${caResponse.RequestId})`);
        res.json({
          message: 'Certificate request submitted — pending CA manager approval',
          status: 'pending',
          requestId: caResponse.RequestId,
        });
      } else {
        csr.errorMessage = caResponse.Error || 'Unknown CA response';
        csr.status = 'failed';
        updateWorkflowStep(csr, 'Submit to CA', 'failed', caResponse.Error);
        await csr.save();

        res.status(500).json({ error: 'CA submission failed', details: caResponse.Error });
      }
    } else {
      csr.errorMessage = result.error;
      csr.status = 'failed';
      updateWorkflowStep(csr, 'Submit to CA', 'failed', result.error);
      await csr.save();

      res.status(500).json({ error: 'Failed to submit CSR', details: result.error });
    }
  } catch (error) {
    logger.error('Submit CSR error:', error);
    res.status(500).json({ error: 'Failed to submit CSR' });
  }
}

// ─── DELIVER CERTIFICATE (Apache path) ──────────────────────────────────────────

export async function deliverCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id);

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status !== 'issued') {
      res.status(400).json({ error: 'Certificate must be issued before delivery' });
      return;
    }

    if (csr.serverType !== 'apache') {
      res.status(400).json({ error: 'Delivery is only available for Apache certificates. IIS certificates are installed directly.' });
      return;
    }

    if (!csr.issuedCertPEM) {
      res.status(400).json({ error: 'No issued certificate available' });
      return;
    }

    if (!csr.deliveryEmails || csr.deliveryEmails.length === 0) {
      res.status(400).json({ error: 'No delivery email addresses configured' });
      return;
    }

    // Mark as delivering
    csr.status = 'delivering';
    updateWorkflowStep(csr, 'Deliver Certificate', 'pending');
    await csr.save();

    const result = await deliverApacheCertificate({
      csrId: String(csr._id),
      commonName: csr.commonName,
      recipients: csr.deliveryEmails,
      certPEM: csr.issuedCertPEM,
      requestedBy: csr.requestedBy,
    });

    if (result.success) {
      csr.status = 'completed';
      csr.deliveredAt = new Date();
      csr.privateKeyLocation = undefined;
      updateWorkflowStep(csr, 'Deliver Certificate', 'completed');
      await csr.save();

      logger.info(`Certificate for ${csr.commonName} delivered to ${csr.deliveryEmails.join(', ')} by ${req.user?.username}`);
      res.json({ message: 'Certificate delivered successfully' });
    } else {
      csr.status = 'issued'; // Revert so delivery can be retried
      csr.errorMessage = result.error;
      updateWorkflowStep(csr, 'Deliver Certificate', 'failed', result.error);
      await csr.save();

      res.status(500).json({ error: 'Certificate delivery failed', details: result.error });
    }
  } catch (error) {
    logger.error('Deliver CSR error:', error);
    res.status(500).json({ error: 'Failed to deliver certificate' });
  }
}

// ─── INSTALL CERTIFICATE (IIS path) ──────────────────────────────────────────────

export async function installCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id)
      .populate('targetServerId');

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status !== 'issued') {
      res.status(400).json({ error: 'Certificate must be issued before installation' });
      return;
    }

    if (csr.serverType !== 'iis') {
      res.status(400).json({ error: 'Installation is only available for IIS certificates. Apache certificates are delivered via email.' });
      return;
    }

    if (!csr.issuedCertPEM) {
      res.status(400).json({ error: 'No issued certificate available' });
      return;
    }

    if (!csr.targetServerId) {
      res.status(400).json({ error: 'No target server configured for this IIS request' });
      return;
    }

    const targetServer = csr.targetServerId as any;
    const computerName = targetServer?.fqdn || targetServer?.hostname;

    if (!computerName) {
      res.status(400).json({ error: 'Target server has no FQDN or hostname configured' });
      return;
    }

    if (computerName !== 'localhost' && !validateHostname(computerName)) {
      res.status(400).json({ error: 'Invalid target server hostname' });
      return;
    }

    // Mark as delivering (installing)
    csr.status = 'delivering';
    updateWorkflowStep(csr, 'Install Certificate', 'pending');
    await csr.save();

    try {
      // Install the issued certificate on the target server via PSRemoting.
      // Uses the IX509Enrollment COM API (InstallResponse) to pair the issued
      // certificate with the pending request's private key — same CryptoAPI
      // that certreq -accept uses internally, but without console dependency.
      const safeId = String(csr._id);

      // Base64 encode the cert PEM to avoid here-string parsing issues
      // when the script is wrapped inside Invoke-Command -ScriptBlock { } for PSRemoting.
      const certBase64 = Buffer.from(csr.issuedCertPEM, 'utf-8').toString('base64');

      const result = await executePowerShell({
        script: `
          Write-Host '[INSTALL-1] Starting certificate installation via COM API'
          $certPEM = [System.Text.Encoding]::ASCII.GetString([System.Convert]::FromBase64String('${certBase64}'))
          Write-Host "[INSTALL-2] Cert PEM decoded, length=$($certPEM.Length)"

          # Use IX509Enrollment COM API to install the response.
          # This pairs the issued certificate with the pending request's private key
          # that was created during CSR generation. The matching is done automatically
          # by the CryptoAPI based on the public key in the certificate.
          $enrollment = New-Object -ComObject X509Enrollment.CX509Enrollment
          $enrollment.Initialize(2)  # 2 = MachineContext
          Write-Host '[INSTALL-3] Enrollment initialized for machine context'

          # InstallResponse parameters:
          #   Restriction: 2 = AllowUntrustedCertificate (internal CA certs may not chain to a trusted root on this machine)
          #   Response: the certificate PEM text
          #   Encoding: 6 = XCN_CRYPT_STRING_BASE64_ANY (accepts PEM with or without headers)
          #   Password: empty (not a PFX)
          $enrollment.InstallResponse(2, $certPEM, 6, "")
          Write-Host '[INSTALL-4] Certificate installed successfully'

          # Verify the certificate is now in the store
          $installedCert = Get-ChildItem -Path Cert:\\LocalMachine\\My | Where-Object {
            $_.Subject -match '${sanitizePSString(csr.commonName)}'
          } | Sort-Object NotAfter -Descending | Select-Object -First 1

          if ($installedCert) {
            Write-Host "[INSTALL-5] Certificate verified in store: $($installedCert.Thumbprint)"
            $result = @{
              Success = $true
              Thumbprint = $installedCert.Thumbprint
              Subject = $installedCert.Subject
              NotAfter = $installedCert.NotAfter.ToString("o")
              SerialNumber = $installedCert.SerialNumber
              Store = "LocalMachine\\My"
            }
            $result | ConvertTo-Json -Compress
          } else {
            Write-Host '[INSTALL-5] Certificate installed but could not be verified by CN match'
            $result = @{
              Success = $true
              Message = "Certificate installed via COM API but could not be verified in store by CN match"
            }
            $result | ConvertTo-Json -Compress
          }
        `,
        remoteComputer: computerName !== 'localhost' ? computerName : undefined,
        timeout: 120000, // 2 minutes
      });

      if (result.success) {
        let installResult: any = {};
        try {
          // Extract JSON from mixed Write-Host output
          const jsonOutput = extractJSONFromOutput(result.output);
          installResult = JSON.parse(jsonOutput);
        } catch {
          installResult = { Success: true, Message: result.output };
        }

        csr.status = 'completed';
        csr.deliveredAt = new Date();
        csr.privateKeyLocation = `${computerName}:LocalMachine\\My`;
        updateWorkflowStep(csr, 'Install Certificate', 'completed');

        // Link the issued certificate to the Certificate inventory if we have a thumbprint.
        // This gives immediate visibility — the next CA sync will enrich with full details.
        const thumbprintToMatch = installResult.Thumbprint || csr.issuedThumbprint;
        const serialToMatch = installResult.SerialNumber || csr.issuedSerialNumber;

        if (thumbprintToMatch || serialToMatch) {
          try {
            let linkedCert = thumbprintToMatch
              ? await Certificate.findOne({ thumbprint: thumbprintToMatch })
              : null;

            if (!linkedCert && serialToMatch) {
              linkedCert = await Certificate.findOne({ serialNumber: serialToMatch });
            }

            if (linkedCert) {
              csr.issuedCertificateId = linkedCert._id;
              if (!linkedCert.serverType) {
                linkedCert.serverType = 'iis';
                await linkedCert.save();
              }
              logger.info(`Linked CSR ${csr._id} to Certificate ${linkedCert._id} (${linkedCert.thumbprint})`);
            }
            // If cert not found, the next CA sync will pick it up
          } catch (linkErr) {
            // Don't fail the install if certificate linking fails
            logger.warn(`Could not link issued certificate for ${csr.commonName}: ${linkErr}`);
          }
        }

        await csr.save();

        logger.info(`IIS certificate for ${csr.commonName} installed on ${computerName} by ${req.user?.username} (Thumbprint: ${installResult.Thumbprint || 'unknown'})`);

        res.json({
          message: 'Certificate installed successfully on target server',
          server: computerName,
          thumbprint: installResult.Thumbprint,
          serialNumber: installResult.SerialNumber,
          store: installResult.Store || 'LocalMachine\\My',
        });
      } else {
        csr.status = 'issued'; // Revert so install can be retried
        csr.errorMessage = result.error;
        updateWorkflowStep(csr, 'Install Certificate', 'failed', result.error);
        await csr.save();

        logger.error(`IIS certificate install failed for ${csr.commonName} on ${computerName}: ${result.error}`);
        res.status(500).json({ error: 'Certificate installation failed', details: result.error });
      }
    } catch (installError: any) {
      csr.status = 'issued'; // Revert so install can be retried
      csr.errorMessage = installError.message;
      updateWorkflowStep(csr, 'Install Certificate', 'failed', installError.message);
      await csr.save();

      logger.error(`IIS certificate install error for ${csr.commonName}: ${installError.message}`);
      res.status(500).json({ error: 'Certificate installation failed', details: installError.message });
    }
  } catch (error) {
    logger.error('Install CSR error:', error);
    res.status(500).json({ error: 'Failed to install certificate' });
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────────

export async function deleteCSR(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const csr = await CSRRequest.findById(id);

    if (!csr) {
      res.status(404).json({ error: 'CSR request not found' });
      return;
    }

    if (csr.status === 'submitted' || csr.status === 'delivering') {
      res.status(400).json({ error: 'Cannot delete a CSR that is being processed' });
      return;
    }

    // Clean up any temp files for Apache CSRs
    if (csr.serverType === 'apache') {
      const keyPath = getKeyPath(String(csr._id));
      const csrFilePath = getCSRPath(String(csr._id));
      try { if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath); } catch {}
      try { if (fs.existsSync(csrFilePath)) fs.unlinkSync(csrFilePath); } catch {}
    }

    await csr.deleteOne();

    logger.info(`CSR request for ${csr.commonName} deleted by ${req.user?.username}`);

    res.json({ message: 'CSR request deleted' });
  } catch (error) {
    logger.error('Delete CSR error:', error);
    res.status(500).json({ error: 'Failed to delete CSR request' });
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────────

/**
 * Extract PEM content from PowerShell output that may contain Write-Host debug lines.
 * Looks for -----BEGIN ... REQUEST----- through -----END ... REQUEST----- markers.
 */
function extractPEMFromOutput(output: string): string | null {
  const match = output.match(/-----BEGIN[\s\S]*?CERTIFICATE REQUEST-----[\s\S]*?-----END[\s\S]*?CERTIFICATE REQUEST-----/);
  return match ? match[0].trim() : null;
}

/**
 * Extract JSON from PowerShell output that may contain Write-Host debug lines.
 * Looks for the first { ... } block in the output.
 */
function extractJSONFromOutput(output: string): string {
  const match = output.match(/\{[\s\S]*\}/);
  return match ? match[0] : output.trim();
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

/**
 * Build a hex bitmask string for the INF KeyUsage field.
 * E.g. ['digitalSignature', 'keyEncipherment'] → 'a0'
 */
function buildKeyUsageBitmask(keyUsages: string[]): string {
  const bits: Record<string, number> = {
    'digitalSignature': 0x80,
    'nonRepudiation':   0x40,
    'keyEncipherment':  0x20,
    'dataEncipherment': 0x10,
    'keyAgreement':     0x08,
    'keyCertSign':      0x04,
    'crlSign':          0x02,
    'encipherOnly':     0x01,
    'decipherOnly':     0x8000,
  };

  let mask = 0;
  for (const ku of keyUsages) {
    if (bits[ku] !== undefined) {
      mask |= bits[ku];
    }
  }
  return mask.toString(16);
}

/**
 * Map extended key usage names to OIDs for the INF [EnhancedKeyUsageExtension] section.
 */
function buildEKUOids(ekus: string[]): string[] {
  const oidMap: Record<string, string> = {
    'serverAuth':         '1.3.6.1.5.5.7.3.1',
    'clientAuth':         '1.3.6.1.5.5.7.3.2',
    'codeSigning':        '1.3.6.1.5.5.7.3.3',
    'emailProtection':    '1.3.6.1.5.5.7.3.4',
    'timeStamping':       '1.3.6.1.5.5.7.3.8',
    'ocspSigning':        '1.3.6.1.5.5.7.3.9',
    'smartCardLogon':     '1.3.6.1.4.1.311.20.2.2',
    'kdcAuthentication':  '1.3.6.1.5.2.3.5',
  };

  return ekus.map(eku => oidMap[eku]).filter(Boolean);
}