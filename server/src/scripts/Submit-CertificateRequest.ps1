# Submit-CertificateRequest.ps1
# Submits a CSR to a Certificate Authority

param(
    [Parameter(Mandatory=$true)]
    [string]$CSRPath,

    [Parameter(Mandatory=$true)]
    [string]$ConfigString,

    [Parameter(Mandatory=$true)]
    [string]$Template
)

$ErrorActionPreference = "Stop"

try {
    # Verify CSR file exists
    if (-not (Test-Path $CSRPath)) {
        throw "CSR file not found: $CSRPath"
    }

    # Create output path for certificate
    $certPath = $CSRPath -replace '\.csr$', '.cer'

    # Submit request to CA
    $submitOutput = certreq -submit -config $ConfigString -attrib "CertificateTemplate:$Template" $CSRPath $certPath 2>&1

    if ($LASTEXITCODE -ne 0) {
        # Check if request is pending
        if ($submitOutput -match "pending") {
            $requestId = if ($submitOutput -match "RequestId:\s*(\d+)") { $Matches[1] } else { "unknown" }

            $result = @{
                Success = $true
                Status = "Pending"
                RequestId = $requestId
                Message = "Certificate request is pending approval"
            }
            $result | ConvertTo-Json -Compress
            exit 0
        }
        throw "certreq submit failed: $submitOutput"
    }

    # Check if certificate was issued
    if (Test-Path $certPath) {
        $certContent = Get-Content $certPath -Raw

        # Get certificate details
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath)

        $result = @{
            Success = $true
            Status = "Issued"
            CertificatePath = $certPath
            CertificateContent = $certContent
            Thumbprint = $cert.Thumbprint
            SerialNumber = $cert.SerialNumber
            Subject = $cert.Subject
            NotBefore = $cert.NotBefore.ToString("o")
            NotAfter = $cert.NotAfter.ToString("o")
        }

        $result | ConvertTo-Json -Compress
    } else {
        throw "Certificate was not issued"
    }

} catch {
    $result = @{
        Success = $false
        Status = "Failed"
        Error = $_.Exception.Message
    }
    $result | ConvertTo-Json -Compress
    exit 1
}
