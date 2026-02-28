# Get-IssuedCertificates.ps1
# Retrieves issued certificates from a Windows Certificate Authority
# Uses ICertView2 COM object with batched iteration to prevent COM handle timeout
# Each batch uses a single RequestID >= restriction, reads N rows, then reconnects

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString,

    [Parameter(Mandatory=$false)]
    [string]$SinceDate = "",

    [Parameter(Mandatory=$false)]
    [string]$OutputFile = "",

    [Parameter(Mandatory=$false)]
    [int]$BatchSize = 5000
)

$ErrorActionPreference = "Stop"

try {
    # Build template OID-to-friendly-name lookup from Active Directory
    $templateMap = @{}
    try {
        $configRoot = [ADSI]"LDAP://RootDSE"
        $configDN = $configRoot.configurationNamingContext

        # Source 1: Certificate Templates container (maps name + OID to displayName)
        $templateContainer = [ADSI]"LDAP://CN=Certificate Templates,CN=Public Key Services,CN=Services,$configDN"
        $searcher = New-Object DirectoryServices.DirectorySearcher($templateContainer)
        $searcher.Filter = "(objectClass=pKICertificateTemplate)"
        $searcher.PropertiesToLoad.AddRange(@("name", "displayName", "msPKI-Cert-Template-OID"))
        $searcher.PageSize = 1000
        $results = $searcher.FindAll()
        foreach ($result in $results) {
            $oid = $result.Properties["mspki-cert-template-oid"]
            $displayName = $result.Properties["displayname"]
            $name = $result.Properties["name"]
            $friendlyName = if ($displayName -and $displayName.Count -gt 0) { $displayName[0] } elseif ($name -and $name.Count -gt 0) { $name[0] } else { "" }
            if ($oid -and $oid.Count -gt 0 -and $friendlyName) {
                $templateMap[$oid[0]] = $friendlyName
            }
            if ($name -and $name.Count -gt 0 -and $friendlyName) {
                $templateMap[$name[0]] = $friendlyName
            }
        }

        # Source 2: OID container (maps msPKI-Cert-Template-OID to displayName)
        $oidContainer = [ADSI]"LDAP://CN=OID,CN=Public Key Services,CN=Services,$configDN"
        $oidSearcher = New-Object DirectoryServices.DirectorySearcher($oidContainer)
        $oidSearcher.Filter = "(objectClass=msPKI-Enterprise-Oid)"
        $oidSearcher.PropertiesToLoad.AddRange(@("displayName", "msPKI-Cert-Template-OID"))
        $oidSearcher.PageSize = 1000
        $oidResults = $oidSearcher.FindAll()
        foreach ($result in $oidResults) {
            $oid = $result.Properties["mspki-cert-template-oid"]
            $displayName = $result.Properties["displayname"]
            if ($oid -and $oid.Count -gt 0 -and $displayName -and $displayName.Count -gt 0) {
                if (-not $templateMap.ContainsKey($oid[0])) {
                    $templateMap[$oid[0]] = $displayName[0]
                }
            }
        }
    } catch {
        # If AD lookup fails, continue without template resolution
    }

    $Columns = @(
        "RequestID",
        "CommonName",
        "NotBefore",
        "NotAfter",
        "SerialNumber",
        "CertificateTemplate",
        "DistinguishedName",
        "RawCertificate"
    )

    $certificates = [System.Collections.ArrayList]::new()
    $nextStartID = 1
    $batchNum = 0

    while ($true) {
        $batchNum++
        $batchCount = 0
        $lastSeenID = 0

        try {
            $CaView = New-Object -ComObject CertificateAuthority.View
            $CaView.OpenConnection($ConfigString)

            $CaView.SetResultColumnCount($Columns.Count)
            foreach ($Col in $Columns) {
                $CaView.SetResultColumn($CaView.GetColumnIndex($false, $Col))
            }

            # Filter: Disposition = 20 (Issued)
            $CaView.SetRestriction(
                $CaView.GetColumnIndex($false, "Disposition"),
                1, 0, 20
            )

            # Filter: RequestID >= nextStartID (single restriction on RequestID)
            $CaView.SetRestriction(
                $CaView.GetColumnIndex($false, "RequestID"),
                16, 0, $nextStartID  # CVR_SEEK_GE = 16
            )

            # If SinceDate is provided, restrict to certs not yet expired as of that date
            if ($SinceDate -ne "") {
                $sinceDateTime = [DateTime]::Parse($SinceDate)
                $CaView.SetRestriction(
                    $CaView.GetColumnIndex($false, "NotAfter"),
                    16, 0, $sinceDateTime
                )
            }

            $Row = $CaView.OpenView()

            while ($Row.Next() -ne -1) {
                $ColEnum = $Row.EnumCertViewColumn()
                $CertData = [ordered]@{}
                while ($ColEnum.Next() -ne -1) {
                    $CertData[$ColEnum.GetDisplayName()] = $ColEnum.GetValue(0)
                }

                # Track the RequestID for next batch
                $reqID = $CertData["Request ID"]
                if ($reqID -and $reqID -gt $lastSeenID) {
                    $lastSeenID = $reqID
                }

                # Defaults
                $SANs = @()
                $KeyUsage = @()
                $ExtendedKeyUsage = @()
                $SignatureAlgorithm = ""
                $KeyLength = 0
                $Thumbprint = ""
                $Subject = ""
                $CommonName = ""

                # Parse the raw certificate for extensions
                try {
                    if ($CertData["Binary Certificate"]) {
                        $RawB64 = $CertData["Binary Certificate"] -replace "-----BEGIN CERTIFICATE-----" -replace "-----END CERTIFICATE-----" -replace "`r" -replace "`n"
                        $CertBytes = [Convert]::FromBase64String($RawB64)
                        $X509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$CertBytes)

                        $Subject = $X509.Subject
                        $Thumbprint = $X509.Thumbprint
                        $SignatureAlgorithm = $X509.SignatureAlgorithm.FriendlyName
                        try { $KeyLength = $X509.PublicKey.Key.KeySize } catch { $KeyLength = 0 }

                        if ($Subject -match 'CN=([^,]+)') {
                            $CommonName = $Matches[1]
                        }

                        foreach ($Ext in $X509.Extensions) {
                            # Subject Alternative Names
                            if ($Ext.Oid.Value -eq "2.5.29.17") {
                                $sanString = $Ext.Format($false)
                                $SANs = @($sanString -split ", " | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
                            }
                            # Key Usage
                            if ($Ext.Oid.Value -eq "2.5.29.15") {
                                $KUExt = [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]$Ext
                                $KeyUsage = @($KUExt.KeyUsages.ToString() -split ", " | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
                            }
                            # Extended Key Usage
                            if ($Ext.Oid.Value -eq "2.5.29.37") {
                                $EKUExt = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$Ext
                                $ExtendedKeyUsage = @($EKUExt.EnhancedKeyUsages | ForEach-Object { $_.FriendlyName })
                            }
                        }
                        $X509.Dispose()
                    }
                }
                catch {}

                # Use parsed CN, fall back to DB value
                if (-not $CommonName) { $CommonName = $CertData["Issued Common Name"] }

                # Resolve template OID to friendly name
                $rawTemplate = $CertData["Certificate Template"]
                $resolvedTemplate = $rawTemplate
                if ($rawTemplate -and $templateMap.ContainsKey($rawTemplate)) {
                    $resolvedTemplate = $templateMap[$rawTemplate]
                }

                $cert = @{
                    SerialNumber    = $CertData["Serial Number"]
                    CommonName      = $CommonName
                    Subject         = $Subject
                    NotBefore       = if ($CertData["Certificate Effective Date"]) { ([DateTime]$CertData["Certificate Effective Date"]).ToString("o") } else { "" }
                    NotAfter        = if ($CertData["Certificate Expiration Date"]) { ([DateTime]$CertData["Certificate Expiration Date"]).ToString("o") } else { "" }
                    Template        = $resolvedTemplate
                    Thumbprint      = $Thumbprint
                    KeySize         = $KeyLength
                    EncryptionType  = $SignatureAlgorithm
                    SANs            = $SANs
                    KeyUsage        = $KeyUsage
                    ExtendedKeyUsage = $ExtendedKeyUsage
                }

                [void]$certificates.Add($cert)
                $batchCount++

                # After BatchSize rows, break out to reconnect
                if ($batchCount -ge $BatchSize) {
                    break
                }
            }

            # Release COM objects
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($Row) | Out-Null
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($CaView) | Out-Null
        }
        catch {
            Write-Warning "Batch $batchNum (starting at ID $nextStartID) failed: $_"
        }

        Write-Host "Batch $batchNum complete: $batchCount certs (total: $($certificates.Count))" -ForegroundColor Cyan

        # If we got fewer rows than BatchSize, we've reached the end
        if ($batchCount -lt $BatchSize) {
            break
        }

        # Next batch starts after the last RequestID we saw
        $nextStartID = $lastSeenID + 1
    }

    # Output as JSON - write to file if specified to avoid Node.js string length limits
    $json = $certificates | ConvertTo-Json -Depth 3 -Compress
    if ($OutputFile -ne "") {
        [System.IO.File]::WriteAllText($OutputFile, $json)
        Write-Output "FILE:$OutputFile"
    } else {
        Write-Output $json
    }

} catch {
    Write-Error "Failed to retrieve certificates: $_"
    exit 1
}