$CaView = New-Object -ComObject CertificateAuthority.View
$CaView.OpenConnection("TSCERAPPPRD01.tuhs.prv\TUHS Root CA")
$CaView.SetResultColumnCount(1)
$CaView.SetResultColumn($CaView.GetColumnIndex($false, "RequestID"))
$CaView.SetRestriction($CaView.GetColumnIndex($false, "Disposition"), 1, 0, 20)
$CaView.SetRestriction($CaView.GetColumnIndex($false, "RequestID"), 16, 0, 9999999)
$Row = $CaView.OpenView()
if ($Row.Next() -ne -1) { $Col = $Row.EnumCertViewColumn(); $Col.Next() | Out-Null; Write-Host "Max RequestID: $($Col.GetValue(0))" }