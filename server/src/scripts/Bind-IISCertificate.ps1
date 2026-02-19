# Bind-IISCertificate.ps1
# Binds a certificate to an IIS website

param(
    [Parameter(Mandatory=$true)]
    [string]$ComputerName,

    [Parameter(Mandatory=$true)]
    [string]$SiteName,

    [Parameter(Mandatory=$true)]
    [string]$Thumbprint,

    [Parameter(Mandatory=$false)]
    [int]$Port = 443,

    [Parameter(Mandatory=$false)]
    [string]$HostHeader = "",

    [Parameter(Mandatory=$false)]
    [string]$IPAddress = "*"
)

$ErrorActionPreference = "Stop"

try {
    $scriptBlock = {
        param($Site, $Thumb, $PortNum, $Header, $IP)

        Import-Module WebAdministration -ErrorAction Stop

        # Verify site exists
        $website = Get-Website -Name $Site -ErrorAction SilentlyContinue
        if (-not $website) {
            throw "Website '$Site' not found"
        }

        # Verify certificate exists
        $cert = Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object { $_.Thumbprint -eq $Thumb }
        if (-not $cert) {
            throw "Certificate with thumbprint '$Thumb' not found in LocalMachine\My store"
        }

        # Check for existing HTTPS binding
        $bindingInfo = "$($IP):$($PortNum):$Header"
        $existingBinding = Get-WebBinding -Name $Site -Protocol https -Port $PortNum -ErrorAction SilentlyContinue

        if ($existingBinding) {
            # Remove existing binding
            Remove-WebBinding -Name $Site -Protocol https -Port $PortNum
        }

        # Create new HTTPS binding
        if ($Header) {
            New-WebBinding -Name $Site -Protocol https -Port $PortNum -IPAddress $IP -HostHeader $Header -SslFlags 1
        } else {
            New-WebBinding -Name $Site -Protocol https -Port $PortNum -IPAddress $IP
        }

        # Get the binding and add SSL certificate
        $binding = Get-WebBinding -Name $Site -Protocol https -Port $PortNum
        $binding.AddSslCertificate($Thumb, "My")

        @{
            Site = $Site
            Port = $PortNum
            Thumbprint = $Thumb
            HostHeader = $Header
        }
    }

    if ($ComputerName -eq "localhost" -or $ComputerName -eq $env:COMPUTERNAME) {
        $result = & $scriptBlock -Site $SiteName -Thumb $Thumbprint -PortNum $Port -Header $HostHeader -IP $IPAddress
    } else {
        $result = Invoke-Command -ComputerName $ComputerName -ScriptBlock $scriptBlock -ArgumentList $SiteName, $Thumbprint, $Port, $HostHeader, $IPAddress
    }

    $output = @{
        Success = $true
        ComputerName = $ComputerName
        SiteName = $result.Site
        Port = $result.Port
        Thumbprint = $result.Thumbprint
        HostHeader = $result.HostHeader
    }

    $output | ConvertTo-Json -Compress

} catch {
    $result = @{
        Success = $false
        ComputerName = $ComputerName
        SiteName = $SiteName
        Error = $_.Exception.Message
    }
    $result | ConvertTo-Json -Compress
    exit 1
}
