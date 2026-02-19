# Install-Certificate.ps1
# Installs a certificate on a remote Windows server

param(
    [Parameter(Mandatory=$true)]
    [string]$ComputerName,

    [Parameter(Mandatory=$true)]
    [string]$CertificatePath,

    [Parameter(Mandatory=$false)]
    [string]$CertStoreLocation = "Cert:\LocalMachine\My",

    [Parameter(Mandatory=$false)]
    [string]$PfxPassword = ""
)

$ErrorActionPreference = "Stop"

try {
    # Determine if this is a PFX or CER file
    $extension = [System.IO.Path]::GetExtension($CertificatePath).ToLower()

    $scriptBlock = {
        param($CertPath, $StoreLocation, $Password, $IsPfx)

        if ($IsPfx) {
            # Import PFX with private key
            if ($Password) {
                $securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
                $cert = Import-PfxCertificate -FilePath $CertPath -CertStoreLocation $StoreLocation -Password $securePassword
            } else {
                $cert = Import-PfxCertificate -FilePath $CertPath -CertStoreLocation $StoreLocation
            }
        } else {
            # Import CER (public key only)
            $cert = Import-Certificate -FilePath $CertPath -CertStoreLocation $StoreLocation
        }

        @{
            Thumbprint = $cert.Thumbprint
            Subject = $cert.Subject
            NotAfter = $cert.NotAfter.ToString("o")
        }
    }

    $isPfx = $extension -eq ".pfx"

    if ($ComputerName -eq "localhost" -or $ComputerName -eq $env:COMPUTERNAME) {
        # Local installation
        $result = & $scriptBlock -CertPath $CertificatePath -StoreLocation $CertStoreLocation -Password $PfxPassword -IsPfx $isPfx
    } else {
        # Remote installation
        # First copy the certificate to the remote server
        $remotePath = "\\$ComputerName\C$\Windows\Temp\$(Split-Path $CertificatePath -Leaf)"
        Copy-Item -Path $CertificatePath -Destination $remotePath -Force

        $result = Invoke-Command -ComputerName $ComputerName -ScriptBlock $scriptBlock -ArgumentList "C:\Windows\Temp\$(Split-Path $CertificatePath -Leaf)", $CertStoreLocation, $PfxPassword, $isPfx

        # Cleanup remote temp file
        Invoke-Command -ComputerName $ComputerName -ScriptBlock { param($Path) Remove-Item $Path -Force -ErrorAction SilentlyContinue } -ArgumentList "C:\Windows\Temp\$(Split-Path $CertificatePath -Leaf)"
    }

    $output = @{
        Success = $true
        ComputerName = $ComputerName
        Thumbprint = $result.Thumbprint
        Subject = $result.Subject
        NotAfter = $result.NotAfter
    }

    $output | ConvertTo-Json -Compress

} catch {
    $result = @{
        Success = $false
        ComputerName = $ComputerName
        Error = $_.Exception.Message
    }
    $result | ConvertTo-Json -Compress
    exit 1
}
