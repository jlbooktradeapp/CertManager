$configString = "TSCERAPPPRD01.tuhs.prv\TUHS Root CA"  # adjust if different
$outputFile = "D:\CertManager\test-root-sync.json"

# Test just the first 100 certs
$CertAdmin = New-Object -ComObject CertificateAuthority.Admin.1
$CertView = New-Object -ComObject CertificateAuthority.View.1
$CertView.OpenConnection($configString)

$CertView.SetResultColumnCount(1)
$Col0 = $CertView.GetColumnIndex($false, "Request.RequestID")
$CertView.SetResultColumn($Col0)

$Row = $CertView.OpenView()
$count = 0
while ($Row.Next() -ne -1 -and $count -lt 5) {
    $Col = $Row.EnumCertViewColumn()
    $Col.Next() | Out-Null
    Write-Host "RequestID: $($Col.GetValue(1))"
    $count++
}
$Row.Reset()
Write-Host "COM connection works, got $count rows"