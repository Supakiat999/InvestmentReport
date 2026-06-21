# set-line-secrets.ps1 - set the two LINE token secrets on the Cloudflare worker.
# Runs from the notifier folder automatically; Wrangler prompts you to paste each value.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "Setting LINE_CHANNEL_SECRET - paste your Channel secret (Basic settings tab), then Enter:" -ForegroundColor Cyan
npx --yes wrangler secret put LINE_CHANNEL_SECRET

Write-Host ""
Write-Host "Setting LINE_CHANNEL_ACCESS_TOKEN - paste your long-lived Channel access token (Messaging API tab), then Enter:" -ForegroundColor Cyan
npx --yes wrangler secret put LINE_CHANNEL_ACCESS_TOKEN

Write-Host ""
Write-Host "Done - both secrets set. Tell Claude 'set' to wire the webhook." -ForegroundColor Green
