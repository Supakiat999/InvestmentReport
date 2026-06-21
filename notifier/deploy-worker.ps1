# deploy-worker.ps1 — deploy the Cloudflare Worker that powers the in-chat "Report Now" button.
# Interactive: a browser opens for `wrangler login`, and each secret prompt asks you to paste a value.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host '[1/3] Logging in to Cloudflare (a browser window will open)...' -ForegroundColor Cyan
npx wrangler login
Write-Host '[2/3] Deploying the worker...' -ForegroundColor Cyan
npx wrangler deploy
Write-Host '[3/3] Setting secrets (paste each value when prompted)...' -ForegroundColor Cyan
Write-Host '  LINE_CHANNEL_ACCESS_TOKEN = Messaging API tab -> Channel access token (long-lived)'
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
Write-Host '  LINE_CHANNEL_SECRET       = Basic settings -> Channel secret'
npx wrangler secret put LINE_CHANNEL_SECRET
Write-Host '  PORTFOLIO_JSON            = paste the entire contents of notifier\portfolio.json'
npx wrangler secret put PORTFOLIO_JSON

Write-Host "`nDeployed. Copy the worker URL printed above, then in the LINE console (Messaging API tab):" -ForegroundColor Green
Write-Host "set Webhook URL = https://<that-url>/line, click Verify, and enable 'Use webhook'." -ForegroundColor Green
