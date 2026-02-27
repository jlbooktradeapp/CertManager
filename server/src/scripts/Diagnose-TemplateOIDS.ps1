# Diagnose-TemplateOIDs.ps1
# Compares what the CA database has vs what AD can resolve
# Run on the CertManager server

param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigString   # e.g. "yourCA\SubCA"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Step 1: Building template map from AD ===" -ForegroundColor Cyan

$templateMap = @{}

# Source 1: Certificate Templates container
$configRoot = [ADSI]"LDAP://RootDSE"
$configDN = $configRoot.configurationNamingContext

Write-Host "`nCertificate Templates container:" -ForegroundColor Yellow
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
    
    if ($oid -and $oid.Count -gt 0) {
        $templateMap[$oid[0]] = $friendlyName
        Write-Host "  OID: $($oid[0]) -> $friendlyName"
    }
    if ($name -and $name.Count -gt 0) {
        $templateMap[$name[0]] = $friendlyName
    }
}
Write-Host "  Total from Templates container: $($results.Count)"

# Source 2: OID container
Write-Host "`nOID container:" -ForegroundColor Yellow
$oidContainer = [ADSI]"LDAP://CN=OID,CN=Public Key Services,CN=Services,$configDN"
$oidSearcher = New-Object DirectoryServices.DirectorySearcher($oidContainer)
$oidSearcher.Filter = "(objectClass=msPKI-Enterprise-Oid)"
$oidSearcher.PropertiesToLoad.AddRange(@("displayName", "msPKI-Cert-Template-OID"))
$oidSearcher.PageSize = 1000
$oidResults = $oidSearcher.FindAll()

$oidOnlyCount = 0
foreach ($result in $oidResults) {
    $oid = $result.Properties["mspki-cert-template-oid"]
    $displayName = $result.Properties["displayname"]
    if ($oid -and $oid.Count -gt 0 -and $displayName -and $displayName.Count -gt 0) {
        if (-not $templateMap.ContainsKey($oid[0])) {
            $templateMap[$oid[0]] = $displayName[0]
            Write-Host "  OID (new): $($oid[0]) -> $($displayName[0])"
            $oidOnlyCount++
        }
    }
}
Write-Host "  Total in OID container: $($oidResults.Count)"
Write-Host "  New OIDs not in Templates container: $oidOnlyCount"

Write-Host "`n=== Step 2: Checking unique templates from CA database ===" -ForegroundColor Cyan

$CaView = New-Object -ComObject CertificateAuthority.View
$CaView.OpenConnection($ConfigString)

$CaView.SetResultColumnCount(1)
$CaView.SetResultColumn($CaView.GetColumnIndex($false, "CertificateTemplate"))
$CaView.SetRestriction(
    $CaView.GetColumnIndex($false, "Disposition"),
    1, 0, 20
)

$Row = $CaView.OpenView()
$uniqueTemplates = @{}

while ($Row.Next() -ne -1) {
    $ColEnum = $Row.EnumCertViewColumn()
    if ($ColEnum.Next() -ne -1) {
        $val = $ColEnum.GetValue(1)  # CV_OUT_BASE64HEADER=1, but 1 = string
        if ($val) {
            if (-not $uniqueTemplates.ContainsKey($val)) {
                $uniqueTemplates[$val] = 0
            }
            $uniqueTemplates[$val]++
        }
    }
}

Write-Host "`n=== Step 3: Resolution Results ===" -ForegroundColor Cyan

$resolved = 0
$unresolved = 0

Write-Host "`nRESOLVED:" -ForegroundColor Green
foreach ($template in ($uniqueTemplates.Keys | Sort-Object)) {
    if ($templateMap.ContainsKey($template)) {
        Write-Host "  $template ($($uniqueTemplates[$template]) certs) -> $($templateMap[$template])"
        $resolved++
    }
}

Write-Host "`nUNRESOLVED:" -ForegroundColor Red
foreach ($template in ($uniqueTemplates.Keys | Sort-Object)) {
    if (-not $templateMap.ContainsKey($template)) {
        Write-Host "  $template ($($uniqueTemplates[$template]) certs)"
        $unresolved++
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  AD template map entries: $($templateMap.Count)"
Write-Host "  Unique templates in CA: $($uniqueTemplates.Count)"
Write-Host "  Resolved: $resolved"
Write-Host "  Unresolved: $unresolved"

# Check if unresolved OIDs share a common prefix with any resolved ones
if ($unresolved -gt 0) {
    Write-Host "`n=== Step 4: Checking for partial OID matches ===" -ForegroundColor Cyan
    foreach ($template in ($uniqueTemplates.Keys | Sort-Object)) {
        if (-not $templateMap.ContainsKey($template) -and $template -match '^\d+\.') {
            # Check if any AD OID is a prefix of this one or vice versa
            foreach ($adOid in $templateMap.Keys) {
                if ($adOid -match '^\d+\.' -and ($template.StartsWith($adOid) -or $adOid.StartsWith($template))) {
                    Write-Host "  NEAR MATCH: CA has '$template' -- AD has '$adOid' -> $($templateMap[$adOid])" -ForegroundColor Yellow
                }
            }
        }
    }
}