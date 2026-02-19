# New-CertificateRequest.ps1
# Generates a Certificate Signing Request (CSR)

param(
    [Parameter(Mandatory=$true)]
    [string]$CommonName,

    [Parameter(Mandatory=$false)]
    [string[]]$SubjectAlternativeNames = @(),

    [Parameter(Mandatory=$false)]
    [string]$Organization = "",

    [Parameter(Mandatory=$false)]
    [string]$OrganizationalUnit = "",

    [Parameter(Mandatory=$false)]
    [string]$Locality = "",

    [Parameter(Mandatory=$false)]
    [string]$State = "",

    [Parameter(Mandatory=$false)]
    [string]$Country = "",

    [Parameter(Mandatory=$false)]
    [ValidateSet(2048, 4096)]
    [int]$KeySize = 2048,

    [Parameter(Mandatory=$false)]
    [ValidateSet("SHA256", "SHA384", "SHA512")]
    [string]$HashAlgorithm = "SHA256",

    [Parameter(Mandatory=$false)]
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

try {
    # Build subject line
    $subjectParts = @("CN=$CommonName")
    if ($Organization) { $subjectParts += "O=$Organization" }
    if ($OrganizationalUnit) { $subjectParts += "OU=$OrganizationalUnit" }
    if ($Locality) { $subjectParts += "L=$Locality" }
    if ($State) { $subjectParts += "S=$State" }
    if ($Country) { $subjectParts += "C=$Country" }
    $subject = $subjectParts -join ", "

    # Create temporary paths
    $tempDir = $env:TEMP
    $requestId = [Guid]::NewGuid().ToString()
    $infPath = Join-Path $tempDir "$requestId.inf"
    $csrPath = if ($OutputPath) { $OutputPath } else { Join-Path $tempDir "$requestId.csr" }

    # Build SAN extension
    $sanSection = ""
    if ($SubjectAlternativeNames.Count -gt 0) {
        $sanEntries = @()
        for ($i = 0; $i -lt $SubjectAlternativeNames.Count; $i++) {
            $sanEntries += "DNS.$($i + 1)=$($SubjectAlternativeNames[$i])"
        }
        $sanSection = @"

[Extensions]
2.5.29.17 = "{text}"
_continue_ = "$($sanEntries -join '&')"
"@
    }

    # Create INF file content
    $infContent = @"
[Version]
Signature="`$Windows NT$"

[NewRequest]
Subject = "$subject"
KeySpec = 1
KeyLength = $KeySize
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
HashAlgorithm = $HashAlgorithm

[EnhancedKeyUsageExtension]
OID=1.3.6.1.5.5.7.3.1
$sanSection
"@

    # Write INF file
    $infContent | Out-File -FilePath $infPath -Encoding ASCII -Force

    # Generate CSR
    $certreqOutput = certreq -new $infPath $csrPath 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "certreq failed: $certreqOutput"
    }

    # Read and output CSR
    if (Test-Path $csrPath) {
        $csrContent = Get-Content $csrPath -Raw

        $result = @{
            Success = $true
            CSRPath = $csrPath
            CSRContent = $csrContent
        }

        $result | ConvertTo-Json -Compress
    } else {
        throw "CSR file was not created"
    }

} catch {
    $result = @{
        Success = $false
        Error = $_.Exception.Message
    }
    $result | ConvertTo-Json -Compress
    exit 1
} finally {
    # Cleanup INF file
    if (Test-Path $infPath) {
        Remove-Item $infPath -Force -ErrorAction SilentlyContinue
    }
}
