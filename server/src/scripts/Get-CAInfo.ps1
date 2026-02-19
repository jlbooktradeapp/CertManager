# Get-CAInfo.ps1
# Retrieves information about a Certificate Authority

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString
)

$ErrorActionPreference = "Stop"

try {
    # Get CA info
    $caInfo = certutil -config $ConfigString -CAInfo

    if ($LASTEXITCODE -ne 0) {
        throw "certutil command failed"
    }

    # Parse CA certificate
    $caCert = certutil -config $ConfigString -ca.cert | Out-String

    # Get CA name from config string
    $configParts = $ConfigString -split '\\'
    $caName = if ($configParts.Count -ge 2) { $configParts[1] } else { $ConfigString }

    # Get templates
    $templates = @()
    $templateOutput = certutil -config $ConfigString -CATemplates 2>$null
    if ($templateOutput) {
        $templateOutput | ForEach-Object {
            if ($_ -match '^(\S+):(.*)$') {
                $templates += @{
                    name = $Matches[1].Trim()
                    displayName = $Matches[2].Trim()
                    oid = ""
                }
            }
        }
    }

    $result = @{
        Name = $caName
        ConfigString = $ConfigString
        Status = "Online"
        Templates = $templates
    }

    $result | ConvertTo-Json -Depth 3 -Compress

} catch {
    Write-Error "Failed to get CA info: $_"
    exit 1
}
