# Get-IssuedCertificates.ps1
# Retrieves all issued certificates from a Windows Certificate Authority

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString
)

$ErrorActionPreference = "Stop"

try {
    # Query the CA database for issued certificates
    $output = certutil -config $ConfigString -view -restrict "Disposition=20" -out "SerialNumber,CommonName,NotBefore,NotAfter,CertificateTemplate,CertificateHash" csv

    if ($LASTEXITCODE -ne 0) {
        throw "certutil command failed with exit code $LASTEXITCODE"
    }

    # Parse CSV output
    $lines = $output -split "`n" | Where-Object { $_ -match '\S' }

    # Skip header line
    $dataLines = $lines | Select-Object -Skip 1

    $certificates = @()

    foreach ($line in $dataLines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        # Parse CSV fields (handle quoted values)
        $fields = $line -split ',' | ForEach-Object { $_.Trim().Trim('"') }

        if ($fields.Count -ge 5) {
            $cert = @{
                SerialNumber = $fields[0]
                CommonName = $fields[1]
                NotBefore = $fields[2]
                NotAfter = $fields[3]
                Template = $fields[4]
                Thumbprint = if ($fields.Count -ge 6) { $fields[5] } else { "" }
                Subject = "CN=$($fields[1])"
                SANs = @()
            }
            $certificates += $cert
        }
    }

    # Output as JSON
    $certificates | ConvertTo-Json -Depth 3 -Compress

} catch {
    Write-Error "Failed to retrieve certificates: $_"
    exit 1
}
