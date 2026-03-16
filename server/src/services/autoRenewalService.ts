import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Certificate } from '../models/Certificate';
import { CertificateAuthority } from '../models/CertificateAuthority';
import { CSRRequest } from '../models/CSRRequest';
import { Server } from '../models/Server';
import { generateOpenSSLCSR, getKeyPath } from './opensslService';
import { deliverApacheCertificate } from './csrDeliveryService';
import { executePowerShell, submitCSR, validateHostname, sanitizePSString } from './powershellService';
import { logger } from '../utils/logger';

export interface RenewalFailure {
  certId: string;
  commonName: string;
  error: string;
}

export interface RenewalResult {
  succeeded: number;
  failed: number;
  skipped: number;
  failures: RenewalFailure[];
}

/**
 * Main entry point — called by the scheduler at 8:30 AM daily.
 *
 * For each certificate with autoRenew.enabled = true whose expiry falls within
 * its configured daysBeforeExpiry window, runs the full CSR generation →
 * CA submission → delivery/install pipeline automatically.
 *
 * Duplicate prevention:
 *   - Skips if lastRenewalAt is within the last 24 hours
 *   - Skips if an active (non-terminal) CSR already exists for the same CN
 */
export async function runAutoRenewal(): Promise<RenewalResult> {
  const result: RenewalResult = { succeeded: 0, failed: 0, skipped: 0, failures: [] };
  const now = new Date();

  logger.info('Auto-renewal job starting');

  // Find all auto-renewal-enabled certs that are within their threshold window
  const candidates = await Certificate.find({
    'autoRenew.enabled': true,
    status: { $nin: ['revoked', 'reissued', 'rebound', 'expired'] },
  }).populate('autoRenew.targetCAId').populate('autoRenew.targetServerId');

  logger.info(`Auto-renewal: ${candidates.length} enabled certificate(s) found`);

  for (const cert of candidates) {
    const cn = cert.commonName;
    const certId = String(cert._id);

    try {
      const daysBeforeExpiry = cert.autoRenew?.daysBeforeExpiry ?? 30;
      const daysLeft = Math.ceil((cert.validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Not within the renewal window yet
      if (daysLeft > daysBeforeExpiry) {
        logger.debug(`Auto-renewal: ${cn} has ${daysLeft} days left (threshold: ${daysBeforeExpiry}) — skipping`);
        result.skipped++;
        continue;
      }

      // Already renewed within the last 24 hours
      if (cert.autoRenew?.lastRenewalAt) {
        const hoursSinceRenewal = (now.getTime() - cert.autoRenew.lastRenewalAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceRenewal < 24) {
          logger.info(`Auto-renewal: ${cn} already renewed ${hoursSinceRenewal.toFixed(1)}h ago — skipping`);
          result.skipped++;
          continue;
        }
      }

      // Active CSR already exists for this CN
      const activeCsr = await CSRRequest.findOne({
        commonName: cn,
        status: { $nin: ['completed', 'failed', 'cancelled'] },
      });
      if (activeCsr) {
        logger.info(`Auto-renewal: ${cn} already has an active CSR (${activeCsr._id}, status: ${activeCsr.status}) — skipping`);
        result.skipped++;
        continue;
      }

      // Resolve which CA to use
      const serverType = cert.serverType || 'apache';
      if (serverType !== 'apache' && serverType !== 'iis') {
        throw new Error(`Unknown serverType: ${serverType}`);
      }

      let ca: any = cert.autoRenew?.targetCAId;
      if (!ca) {
        // Fall back to the issuing CA if it has issuance enabled
        ca = await CertificateAuthority.findById(cert.issuer?.caId);
        if (!ca?.issuanceEnabled) {
          throw new Error('No target CA configured and issuing CA does not have issuance enabled');
        }
      } else if (typeof ca === 'object' && !ca.issuanceEnabled) {
        throw new Error(`Target CA "${ca.name}" does not have issuance enabled`);
      }

      // For IIS, resolve target server
      let targetServer: any = cert.autoRenew?.targetServerId;
      if (serverType === 'iis') {
        if (!targetServer) {
          // Try to find it from the cert's deployed locations
          const deployedServerId = cert.deployedTo?.[0]?.serverId;
          if (deployedServerId) {
            targetServer = await Server.findById(deployedServerId);
          }
          if (!targetServer) {
            throw new Error('IIS auto-renewal requires a target server — none configured and none found from discovery');
          }
        }
      }

      // Validate delivery emails for Apache
      if (serverType === 'apache') {
        const emails = cert.autoRenew?.deliveryEmails ?? [];
        if (emails.length === 0) {
          throw new Error('Apache auto-renewal requires delivery email addresses — none configured');
        }
      }

      logger.info(`Auto-renewal: starting renewal for ${cn} (${daysLeft} days left, serverType: ${serverType})`);

      // Build the CSR document
      const deliveryEmails = serverType === 'apache' ? (cert.autoRenew?.deliveryEmails ?? []) : [];
      const workflowSteps = serverType === 'apache'
        ? [
            { step: 'Generate CSR',       status: 'pending' as const },
            { step: 'Submit to CA',        status: 'pending' as const },
            { step: 'Deliver Certificate', status: 'pending' as const },
          ]
        : [
            { step: 'Generate CSR',        status: 'pending' as const },
            { step: 'Submit to CA',        status: 'pending' as const },
            { step: 'Install Certificate', status: 'pending' as const },
          ];

      const csrDoc = await CSRRequest.create({
        commonName:              cert.commonName,
        subjectAlternativeNames: cert.subjectAlternativeNames || [],
        subject:                 cert.subject || {},
        serverType,
        keySize:                 cert.keySize || 2048,
        keyAlgorithm:            'RSA',
        hashAlgorithm:           'SHA256',
        keyUsage:                cert.keyUsage?.length ? cert.keyUsage : ['digitalSignature', 'keyEncipherment'],
        extendedKeyUsage:        cert.extendedKeyUsage?.length ? cert.extendedKeyUsage : ['serverAuth', 'clientAuth'],
        templateName:            cert.templateCN || cert.templateRawValue || cert.templateName || 'WebServer',
        targetCAId:              ca._id,
        targetServerId:          serverType === 'iis' ? targetServer?._id : undefined,
        applicationId:           cert.applicationId || undefined,
        deliveryEmails,
        status:                  'draft',
        requestedBy:             'auto-renewal',
        requestedAt:             new Date(),
        workflowSteps,
      });

      const csrId = String(csrDoc._id);

      if (serverType === 'apache') {
        await renewApache(csrDoc, ca, cert, certId, csrId, deliveryEmails);
      } else {
        await renewIIS(csrDoc, ca, cert, certId, csrId, targetServer);
      }

      // Mark lastRenewalAt on the source certificate
      await Certificate.findByIdAndUpdate(certId, {
        $set: { 'autoRenew.lastRenewalAt': new Date() },
      });

      logger.info(`Auto-renewal: ${cn} completed successfully (csrId: ${csrId})`);
      result.succeeded++;

    } catch (err: any) {
      const errMsg = err?.message || String(err);
      logger.error(`Auto-renewal: ${cn} failed — ${errMsg}`);
      result.failed++;
      result.failures.push({ certId, commonName: cn, error: errMsg });
    }
  }

  logger.info(
    `Auto-renewal job complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`
  );

  return result;
}

/**
 * Run the full renewal pipeline for a single specific certificate immediately.
 * Skips the daysBeforeExpiry window check and lastRenewalAt duplicate guard.
 * Used by the admin-only POST /api/certificates/:id/renew endpoint for testing.
 */
export async function runAutoRenewalForCert(cert: any): Promise<{ csrId: string; serverType: string }> {
  const cn = cert.commonName;
  const certId = String(cert._id);
  const serverType = cert.serverType as 'apache' | 'iis';

  // Resolve CA
  let ca: any = cert.autoRenew?.targetCAId
    ? await CertificateAuthority.findById(cert.autoRenew.targetCAId)
    : await CertificateAuthority.findById(cert.issuer?.caId);

  if (!ca) throw new Error('No CA found for this certificate');
  if (!ca.issuanceEnabled) throw new Error(`CA "${ca.name}" does not have issuance enabled`);

  // Resolve target server for IIS
  let targetServer: any = null;
  if (serverType === 'iis') {
    targetServer = cert.autoRenew?.targetServerId
      ? await Server.findById(cert.autoRenew.targetServerId)
      : cert.deployedTo?.[0]?.serverId
        ? await Server.findById(cert.deployedTo[0].serverId)
        : null;
    if (!targetServer) throw new Error('IIS auto-renewal requires a target server — none configured');
  }

  const deliveryEmails = serverType === 'apache' ? (cert.autoRenew?.deliveryEmails ?? []) : [];
  if (serverType === 'apache' && deliveryEmails.length === 0) {
    throw new Error('Apache auto-renewal requires delivery email addresses — none configured');
  }

  const workflowSteps = serverType === 'apache'
    ? [
        { step: 'Generate CSR',       status: 'pending' as const },
        { step: 'Submit to CA',        status: 'pending' as const },
        { step: 'Deliver Certificate', status: 'pending' as const },
      ]
    : [
        { step: 'Generate CSR',        status: 'pending' as const },
        { step: 'Submit to CA',        status: 'pending' as const },
        { step: 'Install Certificate', status: 'pending' as const },
      ];

  const csrDoc = await CSRRequest.create({
    commonName:              cert.commonName,
    subjectAlternativeNames: cert.subjectAlternativeNames || [],
    subject:                 cert.subject || {},
    serverType,
    keySize:                 cert.keySize || 2048,
    keyAlgorithm:            'RSA',
    hashAlgorithm:           'SHA256',
    keyUsage:                cert.keyUsage?.length ? cert.keyUsage : ['digitalSignature', 'keyEncipherment'],
    extendedKeyUsage:        cert.extendedKeyUsage?.length ? cert.extendedKeyUsage : ['serverAuth', 'clientAuth'],
    templateName:            cert.templateCN || cert.templateRawValue || cert.templateName || 'WebServer',
    targetCAId:              ca._id,
    targetServerId:          serverType === 'iis' ? targetServer?._id : undefined,
    applicationId:           cert.applicationId || undefined,
    deliveryEmails,
    status:                  'draft',
    requestedBy:             'auto-renewal (manual trigger)',
    requestedAt:             new Date(),
    workflowSteps,
  });

  const csrId = String(csrDoc._id);

  if (serverType === 'apache') {
    await renewApache(csrDoc, ca, cert, certId, csrId, deliveryEmails);
  } else {
    await renewIIS(csrDoc, ca, cert, certId, csrId, targetServer);
  }

  await Certificate.findByIdAndUpdate(certId, {
    $set: { 'autoRenew.lastRenewalAt': new Date() },
  });

  logger.info(`Manual auto-renewal complete for ${cn} (csrId: ${csrId})`);
  return { csrId, serverType };
}

// ─── APACHE PATH ─────────────────────────────────────────────────────────────

async function renewApache(
  csrDoc: any,
  ca: any,
  cert: any,
  certId: string,
  csrId: string,
  deliveryEmails: string[]
): Promise<void> {
  const cn = cert.commonName;

  // Step 1 — Generate CSR + private key via OpenSSL
  csrDoc.status = 'generating';
  updateWorkflowStep(csrDoc, 'Generate CSR', 'pending');
  await csrDoc.save();

  const genResult = await generateOpenSSLCSR({
    id: csrId,
    commonName: csrDoc.commonName,
    subjectAlternativeNames: csrDoc.subjectAlternativeNames,
    subject: csrDoc.subject,
    keySize: csrDoc.keySize,
    hashAlgorithm: csrDoc.hashAlgorithm,
    keyUsage: csrDoc.keyUsage,
    extendedKeyUsage: csrDoc.extendedKeyUsage,
  });

  if (!genResult.success || !genResult.csrPEM) {
    csrDoc.status = 'failed';
    csrDoc.errorMessage = sanitizeError(genResult.error);
    updateWorkflowStep(csrDoc, 'Generate CSR', 'failed', genResult.error);
    await csrDoc.save();
    throw new Error(`OpenSSL CSR generation failed: ${genResult.error}`);
  }

  csrDoc.csrPEM = genResult.csrPEM;
  csrDoc.privateKeyLocation = genResult.keyPath;
  csrDoc.status = 'pending';
  updateWorkflowStep(csrDoc, 'Generate CSR', 'completed');
  await csrDoc.save();

  logger.info(`Auto-renewal [${cn}]: CSR generated`);

  // Step 2 — Submit to CA
  await submitToCA(csrDoc, ca, cn);

  logger.info(`Auto-renewal [${cn}]: certificate issued by CA`);

  // Step 3 — Email delivery
  csrDoc.status = 'delivering';
  updateWorkflowStep(csrDoc, 'Deliver Certificate', 'pending');
  await csrDoc.save();

  const deliveryResult = await deliverApacheCertificate({
    csrId,
    commonName: cn,
    recipients: deliveryEmails,
    certPEM: csrDoc.issuedCertPEM,
    requestedBy: 'auto-renewal',
  });

  if (!deliveryResult.success) {
    csrDoc.status = 'issued'; // Keep retryable
    csrDoc.errorMessage = sanitizeError(deliveryResult.error);
    updateWorkflowStep(csrDoc, 'Deliver Certificate', 'failed', deliveryResult.error);
    await csrDoc.save();
    throw new Error(`Certificate delivery failed: ${deliveryResult.error}`);
  }

  csrDoc.status = 'completed';
  csrDoc.deliveredAt = new Date();
  csrDoc.privateKeyLocation = undefined;
  updateWorkflowStep(csrDoc, 'Deliver Certificate', 'completed');
  await csrDoc.save();
}

// ─── IIS PATH ─────────────────────────────────────────────────────────────────

async function renewIIS(
  csrDoc: any,
  ca: any,
  cert: any,
  certId: string,
  csrId: string,
  targetServer: any
): Promise<void> {
  const cn = cert.commonName;
  const computerName = targetServer?.fqdn || targetServer?.hostname || 'localhost';

  if (computerName !== 'localhost' && !validateHostname(computerName)) {
    throw new Error(`Invalid target server hostname: ${computerName}`);
  }

  // Step 1 — Generate CSR on the target server via COM API
  csrDoc.status = 'generating';
  updateWorkflowStep(csrDoc, 'Generate CSR', 'pending');
  await csrDoc.save();

  const subjectLine = buildSubjectLine(csrDoc);
  const kuBitmask   = buildKeyUsageBitmask(csrDoc.keyUsage || ['digitalSignature', 'keyEncipherment']);
  const ekuOids     = buildEKUOids(csrDoc.extendedKeyUsage || ['serverAuth', 'clientAuth']);
  const sansJoined  = csrDoc.subjectAlternativeNames.join('|');
  const ekuOidsJoined = ekuOids.join('|');

  const genResult = await executePowerShell({
    script: `
      $privateKey = New-Object -ComObject X509Enrollment.CX509PrivateKey
      $privateKey.ProviderName = "Microsoft RSA SChannel Cryptographic Provider"
      $privateKey.KeySpec = 1
      $privateKey.Length = ${csrDoc.keySize}
      $privateKey.MachineContext = $true
      $privateKey.ExportPolicy = 1
      $privateKey.Create()

      $request = New-Object -ComObject X509Enrollment.CX509CertificateRequestPkcs10
      $request.InitializeFromPrivateKey(2, $privateKey, "")

      $dn = New-Object -ComObject X509Enrollment.CX500DistinguishedName
      $dn.Encode('${sanitizePSString(subjectLine)}', 0)
      $request.Subject = $dn

      $sansStr = '${sanitizePSString(sansJoined)}'
      if ($sansStr -ne '') {
        $sanExt = New-Object -ComObject X509Enrollment.CX509ExtensionAlternativeNames
        $sanNames = New-Object -ComObject X509Enrollment.CAlternativeNames
        foreach ($sanValue in $sansStr.Split('|')) {
          if ($sanValue.Trim() -ne '') {
            $san = New-Object -ComObject X509Enrollment.CAlternativeName
            $san.InitializeFromString(3, $sanValue.Trim())
            $sanNames.Add($san)
          }
        }
        if ($sanNames.Count -gt 0) {
          $sanExt.InitializeEncode($sanNames)
          $request.X509Extensions.Add($sanExt)
        }
      }

      $kuExt = New-Object -ComObject X509Enrollment.CX509ExtensionKeyUsage
      $kuExt.InitializeEncode(0x${kuBitmask})
      $kuExt.Critical = $true
      $request.X509Extensions.Add($kuExt)

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
        }
      }

      $hashOid = New-Object -ComObject X509Enrollment.CObjectId
      $hashOid.InitializeFromAlgorithmName(1, 0, 0, '${sanitizePSString(csrDoc.hashAlgorithm)}')
      $request.HashAlgorithm = $hashOid

      $enrollment = New-Object -ComObject X509Enrollment.CX509Enrollment
      $enrollment.InitializeFromRequest($request)
      $csrText = $enrollment.CreateRequest(3)
      $csrText
    `,
    remoteComputer: computerName !== 'localhost' ? computerName : undefined,
    timeout: 120000,
  });

  if (!genResult.success) {
    csrDoc.status = 'failed';
    csrDoc.errorMessage = sanitizeError(genResult.error);
    updateWorkflowStep(csrDoc, 'Generate CSR', 'failed', genResult.error);
    await csrDoc.save();
    throw new Error(`IIS CSR generation failed: ${genResult.error}`);
  }

  const csrPEM = extractPEMFromOutput(genResult.output);
  if (!csrPEM) {
    csrDoc.status = 'failed';
    csrDoc.errorMessage = 'CSR generated but PEM could not be extracted from output';
    updateWorkflowStep(csrDoc, 'Generate CSR', 'failed', 'PEM extraction failed');
    await csrDoc.save();
    throw new Error('IIS CSR PEM extraction failed');
  }

  csrDoc.csrPEM = csrPEM;
  csrDoc.privateKeyLocation = `${computerName}:LocalMachine\\My`;
  csrDoc.status = 'pending';
  updateWorkflowStep(csrDoc, 'Generate CSR', 'completed');
  await csrDoc.save();

  logger.info(`Auto-renewal [${cn}]: IIS CSR generated on ${computerName}`);

  // Step 2 — Submit to CA
  await submitToCA(csrDoc, ca, cn);

  logger.info(`Auto-renewal [${cn}]: certificate issued by CA`);

  // Step 3 — Install on target server
  csrDoc.status = 'delivering';
  updateWorkflowStep(csrDoc, 'Install Certificate', 'pending');
  await csrDoc.save();

  const certBase64 = Buffer.from(csrDoc.issuedCertPEM, 'utf-8').toString('base64');

  const installResult = await executePowerShell({
    script: `
      $certPEM = [System.Text.Encoding]::ASCII.GetString([System.Convert]::FromBase64String('${certBase64}'))
      $enrollment = New-Object -ComObject X509Enrollment.CX509Enrollment
      $enrollment.Initialize(2)
      $enrollment.InstallResponse(2, $certPEM, 6, "")

      $installedCert = Get-ChildItem -Path Cert:\\LocalMachine\\My | Where-Object {
        $_.Subject -match '${sanitizePSString(cn)}'
      } | Sort-Object NotAfter -Descending | Select-Object -First 1

      if ($installedCert) {
        @{
          Success = $true
          Thumbprint = $installedCert.Thumbprint
          Subject = $installedCert.Subject
          Store = "LocalMachine\\My"
        } | ConvertTo-Json -Compress
      } else {
        @{ Success = $true; Message = "Installed but could not verify by CN match" } | ConvertTo-Json -Compress
      }
    `,
    remoteComputer: computerName !== 'localhost' ? computerName : undefined,
    timeout: 120000,
  });

  if (!installResult.success) {
    csrDoc.status = 'issued'; // Keep retryable
    csrDoc.errorMessage = sanitizeError(installResult.error);
    updateWorkflowStep(csrDoc, 'Install Certificate', 'failed', installResult.error);
    await csrDoc.save();
    throw new Error(`IIS certificate installation failed: ${installResult.error}`);
  }

  let installData: any = {};
  try {
    const jsonStr = installResult.output.match(/\{[\s\S]*\}/)?.[0] || '{}';
    installData = JSON.parse(jsonStr);
  } catch {
    installData = { Success: true };
  }

  // Try to link the newly issued cert back to the Certificate inventory
  const thumbprint = installData.Thumbprint || csrDoc.issuedThumbprint;
  const serial     = csrDoc.issuedSerialNumber;
  if (thumbprint || serial) {
    try {
      const linked = thumbprint
        ? await Certificate.findOne({ thumbprint })
        : await Certificate.findOne({ serialNumber: serial });
      if (linked) {
        csrDoc.issuedCertificateId = linked._id;
        if (!linked.serverType) {
          linked.serverType = 'iis';
          await linked.save();
        }
      }
    } catch (linkErr) {
      logger.warn(`Auto-renewal [${cn}]: could not link issued certificate — ${linkErr}`);
    }
  }

  csrDoc.status = 'completed';
  csrDoc.deliveredAt = new Date();
  csrDoc.privateKeyLocation = `${computerName}:LocalMachine\\My`;
  updateWorkflowStep(csrDoc, 'Install Certificate', 'completed');
  await csrDoc.save();
}

// ─── SHARED: SUBMIT TO CA ─────────────────────────────────────────────────────

async function submitToCA(csrDoc: any, ca: any, cn: string): Promise<void> {
  updateWorkflowStep(csrDoc, 'Submit to CA', 'pending');
  csrDoc.status = 'submitted';
  await csrDoc.save();

  const tmpDir = os.tmpdir();
  const csrTempPath = path.join(tmpDir, `${csrDoc._id}.csr`);
  fs.writeFileSync(csrTempPath, csrDoc.csrPEM, 'utf-8');

  const submitResult = await submitCSR(
    csrTempPath,
    ca.configString,
    csrDoc.templateName || 'WebServer'
  );

  try { fs.unlinkSync(csrTempPath); } catch {}

  if (!submitResult.success) {
    csrDoc.status = 'failed';
    csrDoc.errorMessage = sanitizeError(submitResult.error);
    updateWorkflowStep(csrDoc, 'Submit to CA', 'failed', submitResult.error);
    await csrDoc.save();
    throw new Error(`CA submission failed: ${submitResult.error}`);
  }

  let caResponse: any = {};
  try {
    caResponse = JSON.parse(submitResult.output);
  } catch {
    caResponse = { Success: true, Status: 'Issued', CertificateContent: submitResult.output };
  }

  if (caResponse.Status === 'Issued' && caResponse.CertificateContent) {
    csrDoc.issuedCertPEM      = caResponse.CertificateContent;
    csrDoc.issuedThumbprint   = caResponse.Thumbprint || undefined;
    csrDoc.issuedSerialNumber = caResponse.SerialNumber || undefined;
    csrDoc.status             = 'issued';
    csrDoc.processedAt        = new Date();
    updateWorkflowStep(csrDoc, 'Submit to CA', 'completed');
    await csrDoc.save();
  } else if (caResponse.Status === 'Pending') {
    // CA requires manual approval — we can't proceed automatically
    csrDoc.status = 'submitted';
    updateWorkflowStep(csrDoc, 'Submit to CA', 'pending');
    await csrDoc.save();
    throw new Error(`CA returned Pending status (RequestId: ${caResponse.RequestId}) — manual approval required. Auto-renewal cannot complete automatically.`);
  } else {
    csrDoc.status = 'failed';
    csrDoc.errorMessage = sanitizeError(caResponse.Error || 'Unknown CA response');
    updateWorkflowStep(csrDoc, 'Submit to CA', 'failed', caResponse.Error);
    await csrDoc.save();
    throw new Error(`CA submission error: ${caResponse.Error || 'Unknown CA response'}`);
  }

  logger.info(`Auto-renewal [${cn}]: issued — thumbprint: ${caResponse.Thumbprint}`);
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

function sanitizeError(error: string | undefined): string {
  if (!error) return 'An unexpected error occurred';
  let s = error;
  s = s.replace(/[A-Z]:\\[^\s,;)}\]]+/gi, '[path]');
  s = s.replace(/\\\\[^\s,;)}\]]+/gi, '[path]');
  s = s.replace(/\/(?:tmp|var|home|usr|etc|mnt|opt)[^\s,;)}\]]*/gi, '[path]');
  s = s.replace(/At line:\d+ char:\d+.*/gs, '');
  s = s.replace(/\+\s+~+.*/g, '');
  s = s.replace(/\+ CategoryInfo\s+:.*/gs, '');
  s = s.replace(/\+ FullyQualifiedErrorId\s+:.*/gs, '');
  s = s.replace(/\n\s*\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  return s.length > 500 ? s.substring(0, 497) + '...' : s || 'An unexpected error occurred';
}

function extractPEMFromOutput(output: string): string | null {
  const match = output.match(/-----BEGIN[\s\S]*?CERTIFICATE REQUEST-----[\s\S]*?-----END[\s\S]*?CERTIFICATE REQUEST-----/);
  return match ? match[0].trim() : null;
}

function buildSubjectLine(csr: any): string {
  const parts: string[] = [`CN=${csr.commonName}`];
  if (csr.subject.organization)       parts.push(`O=${csr.subject.organization}`);
  if (csr.subject.organizationalUnit) parts.push(`OU=${csr.subject.organizationalUnit}`);
  if (csr.subject.locality)           parts.push(`L=${csr.subject.locality}`);
  if (csr.subject.state)              parts.push(`S=${csr.subject.state}`);
  if (csr.subject.country)            parts.push(`C=${csr.subject.country}`);
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
    if (status === 'completed') step.completedAt = new Date();
    if (error) step.error = error;
  }
}

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
    if (bits[ku] !== undefined) mask |= bits[ku];
  }
  return mask.toString(16);
}

function buildEKUOids(ekus: string[]): string[] {
  const oidMap: Record<string, string> = {
    'serverAuth':        '1.3.6.1.5.5.7.3.1',
    'clientAuth':        '1.3.6.1.5.5.7.3.2',
    'codeSigning':       '1.3.6.1.5.5.7.3.3',
    'emailProtection':   '1.3.6.1.5.5.7.3.4',
    'timeStamping':      '1.3.6.1.5.5.7.3.8',
    'ocspSigning':       '1.3.6.1.5.5.7.3.9',
    'smartCardLogon':    '1.3.6.1.4.1.311.20.2.2',
    'kdcAuthentication': '1.3.6.1.5.2.3.5',
  };
  return ekus.map(eku => oidMap[eku]).filter(Boolean);
}