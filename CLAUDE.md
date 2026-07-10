# CLAUDE.md — operating guide for this repo

Personal stock tracker (single-file web app on GitHub Pages) + LINE bot ("Stock Report",
@981xsela) + hourly notifier. Owner: Supakiat999. This repo is **PUBLIC** — treat every commit
as published.

Docs map: `README.md` (overview) · `notifier/README.md` (backend) · `notifier/SETUP.md`
(first-time setup) · `ROADMAP.md` (prioritized next work) · `HANDOFF.md` (private notes,
gitignored — read it locally for sensitive context).

## 🔒 Privacy invariants (highest priority — never break)
- **Never commit real holdings or secret values.** Gitignored and must stay local:
  `portfolio-seed.js`, `notifier/portfolio.json`, `HANDOFF.md`. Never `git add`:
  `11June2026.html`, `portfolio-history.html`, any dated report page (they contain holdings).
- `holdings.enc.json` (committed) is fine — AES-256-GCM, PBKDF2; the passcode is owner-only and
  must never appear in committed files, code, logs, or chat transcripts you control.
- The Cloudflare worker must stay **webhook-only**: no public endpoint may return portfolio
  data (a `/digest` endpoint was removed for this reason — don't reintroduce it, even "for
  debugging"; use `wrangler tail` instead).
- LINE/Cloudflare secrets are entered by the **user only** (safety rule: Claude must not handle
  token values). Use `notifier/set-line-secrets.ps1` and have the user paste values.

## ⚠️ Do-not-break list
- localStorage keys `longview-v2` / `longview-cache-v1` keep their legacy names — renaming
  wipes every user's saved holdings/notes/alerts.
- LINE rich-menu `chatBarText` max 14 chars (deploy fails silently otherwise → API 400).
- LINE OA "Auto-response messages" must stay **OFF** (it steals the reply token from the
  webhook — this exact bug cost a debugging session).
- PowerShell helper scripts must stay **ASCII-only** (Unicode em-dashes/emoji broke parsing
  under Windows PowerShell 5.1 once).
- `digest.mjs`/`worker.mjs` changes need `npx wrangler deploy` from `notifier/` — the webhook
  runs the deployed copy, not the repo.

## Build & verify workflow
- **Tracker:** no build. Preview via the Claude preview server (`.claude/launch.json`,
  python http.server :8099) → test at **375px and desktop**, check console errors, and re-run
  the regression trio: `#t=SYM` deep link, 🔐 passcode unlock (mock `window.prompt`), row expand.
  Live data won't load in preview — inject fake `state.data[t]` then call `renderAll()`.
- **Digest/notifier:** `node notifier/notify.mjs --dry` prints the exact LINE message.
  Chat commands: `node -e "import('./digest.mjs').then(async m=>console.log(await m.stockText('NVDA',{holdings:{}})))"`.
- **Worker:** deploy, then `POST /line` without a signature must return **403**.
- **Publish:** GitHub Pages serves `main` (~1 min after push). Commit holdings-free files only.

## Architecture in one breath
`TrackingStocks.html` = the whole frontend (state in localStorage, Yahoo Finance via public
CORS relays). `notifier/digest.mjs` = shared analytics + message builders (report, stockText,
moodText, ideasText). `notifier/holdings.mjs` = pure chat-trade logic (buy/sell/undo parsing +
apply). `notifier/worker.mjs` = Cloudflare worker: `/line` webhook (HMAC-verified, routes chat
commands, owner-gated holdings edits in the HOLDINGS KV overlay) **and the hourly cron push**
(`wrangler.jsonc` triggers — moved off GitHub Actions 2026-07-09; `notify.yml` is manual-only
now, never re-add its schedule or reports double-send). Rich menu = 6 buttons; "Report Now"
sends text the webhook answers; 5 others deep-link into the tracker (`#live #holdings #mood
#ideas #portfolio`, plus `#t=SYM` per-stock).

## Costs & quotas (stay free)
Cloudflare free plan (no card; worker = webhook + hourly cron + HOLDINGS KV, all free tier —
KV writes only on chat edits). LINE free tier ≈300 pushes/mo —
the hourly schedule uses most of it; **replies are free/unlimited**, so build on replies, never
add broadcast volume without checking `notifier/SETUP.md` quota math.

## Conventions
- Single-file frontend: vanilla JS inside `TrackingStocks.html`, `--var` CSS palette, emoji
  section language shared with LINE messages (💼 📈 🌡 🏆 💔 ⚠️ 💡 🎯).
- Every "advice" surface carries the not-financial-advice disclaimer.
- User-visible naming is "Stock Report"; internal ids/keys may still say `longview` — leave them.
- The user prefers being walked through phone-side verification (LINE taps) — end changes with
  a short "try this on your phone" checklist.
