# Get-IssuedCertificates.ps1
# Retrieves issued certificates from a Windows Certificate Authority
# Optimized for CAs with tens of thousands of certificates

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString,

    [Parameter(Mandatory=$false)]
    [string]$SinceDate = ""
)

$ErrorActionPreference = "Stop"

try {
    # Build restriction filter - Disposition=20 means "issued"
    $restriction = "Disposition=20"

    # If SinceDate is provided, only pull certs issued after that date (incremental sync)
    if ($SinceDate -ne "") {
        $restriction += ",NotAfter>=$SinceDate"
    }

    # Query the CA database for issued certificates
    $output = certutil -config $ConfigString -view -restrict $restriction -out "SerialNumber,CommonName,NotBefore,NotAfter,CertificateTemplate,CertificateHash" csv

    if ($LASTEXITCODE -ne 0) {
        throw "certutil command failed with exit code $LASTEXITCODE"
    }

    # Parse CSV output
    $lines = $output -split "`n" | Where-Object { $_ -match '\S' }

    # Skip header line
    $dataLines = $lines | Select-Object -Skip 1

    # Use ArrayList instead of array += for O(1) append performance
    $certificates = [System.Collections.ArrayList]::new()

    foreach ($line in $dataLines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        # Skip certutil summary lines (e.g., "XX rows" at the end)
        if ($line -match '^\d+ Row') { continue }
        if ($line -match '^Maximum Row') { continue }

        # Parse CSV fields (handle quoted values)
        $fields = $line -split ',' | ForEach-Object { $_.Trim().Trim('"') }

        if ($fields.Count -ge 5) {
            $cert = @{
                SerialNumber = $fields[0]
                CommonName = $fields[1]
                NotBefore = $fields[2]
                NotAfter = $fields[3]
                Template = $fields[4]
                Thumbprint = if ($fields.Count -ge 6) { $fields[5] -replace '\s','' } else { "" }
                Subject = "CN=$($fields[1])"
                SANs = @()
            }
            [void]$certificates.Add($cert)
        }
    }

    # Output as JSON
    $certificates | ConvertTo-Json -Depth 3 -Compress

} catch {
    Write-Error "Failed to retrieve certificates: $_"
    exit 1
}