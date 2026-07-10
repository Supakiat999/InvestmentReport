# notifier/ — backend reference

The LINE bot brain + hourly notifier. First-time setup lives in `SETUP.md`; this file is the
architecture/operations reference for maintaining it.

## Data flow

```
Yahoo Finance (query1.finance.yahoo.com /v8/finance/spark, no key needed)
        │
        ▼
digest.mjs ── shared engine ──────────────────────────────────────────────
  sparkFetch(symbols)   batched price history (chunks of 8, daily closes)
  verdicts(closes)      Weeks (st) + Months (lt) scores 0-100 → BUY…SELL words
                        inputs: RSI14 · SMA20/50/200 · MACD hist · 1M/1Y returns ·
                        52w position · Bollinger %B · Stochastic %K ·
                        50/200 golden-death cross (≤60d) · cycle stage
  stageOf(closes)       Weinstein cycle stage 1-4 (150-day MA slope + position):
                        🟡 Base · 🟢 Uptrend · 🟠 Topping · 🔴 Downtrend
  moodOf(mkt)           fear/greed 0-100 from SPY/VIX/TLT/HYG
  buildDigest(cfg)      the full sectioned report (🎯 Do now → 🏆/💔 → ⚠️ → 💡)
  stockText(sym, cfg)   single-ticker reply: cycle stage, indicators, support/
                        resistance + trail stop, verdicts, ownership, #t= link
  cycleText(cfg)        all holdings grouped by cycle stage
  rankText(cfg, worst)  holdings top-5 strongest / weakest (long-term score)
  compareText(a, b)     two symbols side by side
  moodText()            gauge + plain-English read
  ideasText(cfg)        top-8 not-owned from the 30-name IDEAS universe
        │                                    │
        ▼                                    ▼
notify.mjs (GitHub Actions hourly)     worker.mjs (Cloudflare, always on)
  LINE broadcast + Telegram              POST /line — HMAC-verified webhook
  reads PORTFOLIO_JSON secret            routes chat commands → reply (free)
```

**Command routing** (`worker.mjs → routedReply`): `help` → command list · **trades** (`buy SYM
QTY [@PRICE]` / `add …` / `sell SYM QTY|all` / `reduce …`, parsed by `holdings.mjs`) →
owner-gated edit of the **HOLDINGS KV overlay** · `undo` → swap overlay with its previous copy
(toggle = redo) · `holdings`/`port(folio)` → owner-gated list · `mood`/`market` → moodText ·
`idea(s)` → ideasText · `report` / "📊 Report now" (menu tap) / multi-word text / postback →
full digest · any other single word (≤14 chars, `[a-z0-9.\-^=]`) → stockText, whose not-found
message doubles as the typo hint. Informational replies cached 5 min (Map, cap 50); trades are
never cached and clear both caches so the next report reflects them. Every webhook reply
carries **quick-reply buttons** (`QUICK` in worker.mjs — Report/Cycle/Best/Worst/Holdings/
Mood/Ideas/Help) that appear above the keyboard, so commands are one tap instead of typing;
LINE shows them on mobile only and they vanish once tapped (that's LINE behavior, max 13 items).

**Holdings overlay & ownership:** `getCfg()` = `PORTFOLIO_JSON` secret merged with KV
`overlay.holdings` (entry replaces, `null` deletes). Ownership is trust-on-first-use: the first
LINE userId to issue an edit is stored at KV key `owner`; everyone else gets refused — the
owner should send `holdings` once right after any redeploy that wipes KV (it doesn't normally).
Chat edits are bookkeeping only — nothing places real broker orders.

**Analytics commands** (also owner-gated where they reveal holdings): `cycle`/`stages` →
`cycleText` (every holding's Weinstein stage, grouped) · `best`/`top` and `worst`/`weak` →
`rankText` (holdings ranked by long-term score) · `compare A B` / `vs A B` → `compareText`
(open to anyone, cached like other informational replies).

**Hourly schedule** now runs on the worker (`wrangler.jsonc → triggers.crons`, UTC, same hours
as the old GitHub schedule). `.github/workflows/notify.yml` is **manual-dispatch only** — its
schedule must stay removed or every report sends twice (it also can't see KV edits).

## Deploys & routine operations

| Task | Command (from `notifier/`) |
|---|---|
| Preview the hourly message | `node notify.mjs --dry` |
| Test a chat command | `node -e "import('./digest.mjs').then(async m=>console.log(await m.stockText('NVDA',{holdings:{}})))"` |
| Deploy worker (needed after digest/worker edits) | `npx wrangler deploy` |
| Watch live worker logs | `npx wrangler tail --format pretty` |
| List worker secrets (names only) | `npx wrangler secret list` |
| Set LINE secrets on worker (user pastes values) | `powershell -ExecutionPolicy Bypass -File set-line-secrets.ps1` |
| Rebuild + republish the 6-button rich menu | `powershell -ExecutionPolicy Bypass -File push-menu.ps1` |
| Re-encrypt holdings after they change | `node seed-encrypt.mjs` (prompts for passcode) then commit `../holdings.enc.json` |
| Regenerate PWA icons | `node icon-gen.mjs` |

Health checks: `GET /` on the worker → 200 "webhook only"; unsigned `POST /line` → **403**.
The worker exposes **no data endpoints** by design — keep it that way.

## Secrets (values never in the repo — names only)

| Name | Where | Used by |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | GitHub repo secret + worker secret | broadcast (notify) / reply (worker) |
| `LINE_CHANNEL_SECRET` | worker secret (+ env for richmenu-setup) | webhook HMAC verify, menu API token |
| `PORTFOLIO_JSON` | GitHub repo secret + worker secret | holdings for the report (never public) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | GitHub repo secrets | optional Telegram mirror |

Wrangler secrets must be set **from this folder** (they bind to the `longview-notifier` worker).
A pasted access token that shows as a single `*` in the console is a corrupted paste — re-copy
from LINE Developers → Messaging API (the long-lived token, ~172 chars; don't hit Reissue while
the old one is in use elsewhere).

## Quotas & schedule (stay free)

- LINE free tier ≈ **300 pushes/month**; the hourly cron (`.github/workflows/notify.yml`,
  SET 03:05–09:05 + US 13:05–20:05 UTC, Mon–Fri) consumes most of it.
  **Replies are unlimited and free** — new chat features must use replies, not pushes.
- Cloudflare free plan: 100k requests/day, no card on file, hard-stops instead of billing.
- Yahoo endpoints are public/unauthenticated; sparkFetch chunks ≤8 symbols per request.

## Known gotchas (each cost real debugging time)

1. LINE OA Manager → Response settings → **Auto-response OFF** — when ON it consumes the reply
   token and the webhook's answer never arrives.
2. Rich menu `chatBarText` **≤14 characters** or the create call 400s.
3. PowerShell 5.1 + non-ASCII in `.ps1` files = parser errors; keep helper scripts ASCII.
4. Secrets piped via PowerShell can gain a BOM — `clean()` in worker/notify strips U+FEFF.
5. `wrangler deploy` prompts for login if the OAuth token expired; login opens a browser and
   times out quickly — retry and complete promptly.
6. GitHub's cron can run minutes late; that's normal.
