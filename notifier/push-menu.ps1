# push-menu.ps1 — build the 6-button image and push the "Stock Report" rich menu to LINE.
# You'll be prompted for your LINE Channel secret
# (developers.line.biz -> your channel -> Basic settings -> Channel secret).
# The secret is read at runtime, used only to call LINE's own API, and never stored.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$sec = Read-Host -AsSecureString 'Paste your LINE Channel secret'
$env:LINE_CHANNEL_SECRET = [System.Net.NetworkCredential]::new('', $sec).Password

Write-Host "`n[1/2] Generating the 6-button menu image..." -ForegroundColor Cyan
node richmenu-gen.mjs
Write-Host "`n[2/2] Uploading + setting it as the default menu..." -ForegroundColor Cyan
node richmenu-setup.mjs

$env:LINE_CHANNEL_SECRET = $null
Write-Host "`nDone — open the 'Stock Report' chat in LINE and check the 6-button menu." -ForegroundColor Green
