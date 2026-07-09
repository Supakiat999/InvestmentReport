# Stock Report — personal tracker + LINE bot

A self-contained stock tracker published on GitHub Pages, paired with a LINE Official Account
("Stock Report") that sends an hourly portfolio report and answers chat commands instantly.
Everything runs on free tiers: GitHub Pages + Actions, Cloudflare Workers, LINE Messaging API.

**Live tracker:** https://supakiat999.github.io/InvestmentReport/TrackingStocks.html

## What it does

| Surface | Capability |
|---|---|
| 📱 LINE chat | Type a ticker (`NVDA`, `PTT.BK`) → instant analysis · `mood` · `ideas` · `help` · `report` |
| 📱 LINE menu | 6 buttons: Report Now (in-chat reply) + deep links into the tracker |
| ⏰ Hourly | Sectioned portfolio report (🎯 Do now → winners/losers → weak charts → ideas) during market hours |
| 🖥️ Tracker | Watchlist/Holdings with 4-horizon Buy/Hold/Sell scoring, Action Center, market fear-greed gauge, trade plans, backtests, news, 30-stock idea scanner, real value history, printable report |
| 📲 Mobile | Installable PWA, compact cards, sticky tabs, passcode-gated holdings |

## Repository map

```
TrackingStocks.html      the entire frontend (single file, no build step)
manifest.json, icon-*    PWA install support
holdings.enc.json        holdings, AES-256-GCM encrypted — unlocked in-browser by passcode
notifier/
  digest.mjs             shared analytics + all message builders (report & chat replies)
  worker.mjs             Cloudflare Worker — LINE webhook, command routing (signature-verified)
  notify.mjs             hourly sender (GitHub Actions entry; LINE broadcast + Telegram)
  richmenu-gen.mjs       draws the 6-button menu image   → richmenu-setup.mjs uploads it
  seed-encrypt.mjs       (re)encrypts local holdings into holdings.enc.json
  icon-gen.mjs           draws the PWA icons
  *.ps1                  guided helpers: deploy worker, set secrets, push menu
  SETUP.md               first-time setup guide (LINE channel, secrets, deploy)
  README.md              backend architecture & operations reference
.github/workflows/
  notify.yml             hourly cron (SET + US market hours, Mon–Fri)
```

## Documentation

- **`CLAUDE.md`** — operating guide + guardrails for AI-assisted work on this repo (start here)
- **`notifier/README.md`** — backend deep dive: data flow, commands, deploys, quotas
- **`notifier/SETUP.md`** — step-by-step first-time setup
- **`ROADMAP.md`** — prioritized improvement backlog with acceptance criteria

## Privacy model (the rule that shapes everything)

Real holdings never appear in this public repo in readable form:
- local-only (gitignored): `portfolio-seed.js`, `notifier/portfolio.json`, `HANDOFF.md`
- cloud copies live in encrypted secrets (GitHub Actions / Cloudflare) only
- the committed `holdings.enc.json` is ciphertext; the passcode exists only with the owner
- the worker exposes no data endpoints — it only replies to signature-verified LINE webhooks

## Quick start (development)

```bash
# preview the tracker locally
python -m http.server 8099        # then open http://localhost:8099/TrackingStocks.html

# print the exact LINE report without sending
node notifier/notify.mjs --dry

# deploy the worker after changing digest.mjs / worker.mjs
cd notifier && npx wrangler deploy
```

> All signals are price-chart based and educational — not financial advice.
