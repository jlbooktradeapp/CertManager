# test-iis.ps1 - simulates exactly how Node spawns the IIS CSR generation
# Run with: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File D:\CertManager\test-iis.ps1

Write-Output "STEP1: Starting"

$infBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes(@"
[Version]
Signature="`$Windows NT$"

[NewRequest]
Subject = "CN=test-iis-debug.tuhs.prv"
KeySpec = 1
KeyLength = 2048
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
HashAlgorithm = SHA256
"@))

Write-Output "STEP2: Base64 encoded, starting Invoke-Command"

Invoke-Command -ComputerName 'tscmgrappprd01.tuhs.prv' -ScriptBlock {
  param($b64)
  Write-Output "STEP3: Inside remote session"
  
  $infContent = [System.Text.Encoding]::ASCII.GetString([System.Convert]::FromBase64String($b64))
  $infPath = Join-Path $env:TEMP 'test-debug.inf'
  $csrPath = Join-Path $env:TEMP 'test-debug.csr'
  
  Write-Output "STEP4: Writing INF to $infPath"
  $infContent | Out-File -FilePath $infPath -Encoding ASCII
  
  Write-Output "STEP5: Running certreq -new"
  certreq -new $infPath $csrPath
  
  Write-Output "STEP6: certreq completed, exit code: $LASTEXITCODE"
  
  if (Test-Path $csrPath) {
    Write-Output "STEP7: CSR file exists"
    Remove-Item $infPath, $csrPath -Force -ErrorAction SilentlyContinue
  } else {
    Write-Output "STEP7: CSR file NOT found"
  }
} -ArgumentList $infBase64

Write-Output "STEP8: Done"