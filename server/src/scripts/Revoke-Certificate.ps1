# Revoke-Certificate.ps1
# Revokes a certificate on a Windows Certificate Authority using ICertAdmin2 COM
# Used by CertManager cleanup process to revoke expired certificates before removal

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString,

    [Parameter(Mandatory=$true)]
    [string]$SerialNumber,

    [Parameter(Mandatory=$false)]
    [int]$Reason = 5  # 5 = Cessation of Operation (appropriate for cleanup of expired certs)
)

$ErrorActionPreference = "Stop"

try {
    $CertAdmin = New-Object -ComObject CertificateAuthority.Admin

    # Revoke the certificate
    # ICertAdmin2::RevokeCertificate(strConfig, strSerialNumber, Reason, Date)
    # Date = 0 means use current date
    $CertAdmin.RevokeCertificate($ConfigString, $SerialNumber, $Reason, 0)

    $result = @{
        Success      = $true
        SerialNumber = $SerialNumber
        Message      = "Certificate revoked successfully"
    }

    $result | ConvertTo-Json -Compress
}
catch {
    $errMsg = $_.Exception.Message

    # Check for common error codes
    $result = @{
        Success      = $false
        SerialNumber = $SerialNumber
        Message      = $errMsg
    }

    # 0x80094004 = Certificate already revoked - treat as success
    if ($errMsg -match "0x80094004" -or $errMsg -match "already been revoked") {
        $result.Success = $true
        $result.Message = "Certificate was already revoked"
    }

    $result | ConvertTo-Json -Compress
}