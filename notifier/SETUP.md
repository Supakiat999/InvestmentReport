# 🔔 Longview hourly notifier — setup guide

You get a message on LINE (and Telegram) **every hour during US market hours**
(≈ 20:15 – 03:15 Thailand time, Mon–Fri ≈ 176 messages/month — fits LINE's free tier) with:
portfolio value & today's P/L · market fear/greed + VIX · triggered price alerts ·
best/worst mover · weak charts warning · top 3 stock ideas you don't own yet.

Two engines are included — start with **A (GitHub Actions)**, add **B (Cloudflare)** later for
unlimited on-demand replies.

---

## Part 1 — LINE bot (~10 minutes, free)

> LINE Notify was discontinued in 2025, so we use a LINE Official Account (your own bot).

1. Go to **https://developers.line.biz/console/** → log in with your normal LINE account.
2. **Create a new Provider** (name it anything, e.g. `Longview`).
3. Inside it: **Create a Messaging API channel** → fill the required fields (name `Longview Bot`,
   any category) → Create.
   - If the console asks you to create the channel via **LINE Official Account Manager**
     (https://manager.line.biz) instead: create the account there, then in its
     **Settings → Messaging API** tab, enable Messaging API and link it to your provider.
4. In the channel's **Messaging API** tab:
   - Scan the bot's **QR code** with your phone → **add it as a friend** (you'll be its only friend —
     "broadcast" therefore messages only you).
   - Scroll to **Channel access token (long-lived)** → **Issue** → copy it. This is
     `LINE_CHANNEL_ACCESS_TOKEN`.
5. In the **Basic settings** tab: copy the **Channel secret** → this is `LINE_CHANNEL_SECRET`
   (only needed for Part B replies).
6. In **LINE Official Account Manager → Settings → Response settings**: turn **off**
   "Auto-response messages" (otherwise the bot spams canned replies).

## Part 2 — Telegram bot (~5 minutes, free, unlimited messages)

1. In Telegram, open **@BotFather** → send `/newbot` → pick a name and username
   → copy the token → this is `TELEGRAM_BOT_TOKEN`.
2. Open your new bot's chat and **send it any message** (e.g. "hi").
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser →
   find `"chat":{"id":123456789` → that number is `TELEGRAM_CHAT_ID`.

---

## Part A — GitHub Actions (the simple hourly push)

1. Push this repo to GitHub (the workflow file is `.github/workflows/notify.yml`).
2. On github.com → your repo → **Settings → Secrets and variables → Actions → New repository secret**.
   Add (any you skip are simply not used):
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. Test: repo → **Actions** tab → "Hourly stock notify" → **Run workflow**. Your phone should buzz
   within ~1 minute.
4. Done. It now runs every hour in the market window automatically. (GitHub's scheduler can run
   a few minutes late — normal.)

**Test locally first (no tokens needed):**
```
node notifier/notify.mjs --dry
```
prints the exact message it would send.

## Part B — Cloudflare Worker (replies + always-working data proxy)

What you gain: message your LINE bot **anything, anytime** → it instantly replies with the
fresh digest (LINE replies are free and unlimited — no quota worry), plus a private Yahoo
relay that makes the tracker page itself immune to free-relay outages.

1. Create a free account at **https://dash.cloudflare.com**.
2. Install the CLI: `npm install -g wrangler` → `wrangler login`.
3. From the `notifier/` folder:
   ```
   wrangler deploy
   wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   wrangler secret put LINE_CHANNEL_SECRET
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   ```
   Note the URL it prints, e.g. `https://longview-notifier.<you>.workers.dev`
4. Wire the reply webhook: LINE Developers console → your channel → **Messaging API** tab →
   **Webhook URL** = `https://<your-worker-url>/line` → **Verify** → enable **Use webhook**.
5. Test in a browser: `https://<your-worker-url>/digest` shows the message text.
   Then message your bot in LINE → instant digest back.
6. Tell Claude the worker URL and the tracker page can be wired to use
   `https://<your-worker-url>/yh` as its first, private data relay (ends the
   "couldn't fetch" issue for good).

---

## Updating what it tracks

The notifier reads `notifier/portfolio.json`. When your holdings change:
open TrackingStocks.html → **Portfolio tab → 🔔 Notify cfg** → it downloads a fresh
`portfolio.json` → replace the one in this folder → commit & push.

## Tuning

- **Message hours**: edit the cron in `.github/workflows/notify.yml` and `wrangler.jsonc`
  (`15 13-20 * * 1-5` = minute 15, 13:00–20:00 UTC, Mon–Fri). Thai market hours instead:
  `30 3-9 * * 1-5`.
- **Quota math**: LINE free ≈ 200–300 pushes/month. Current schedule ≈ 176. Telegram = unlimited.
- All signals are chart-based only — not financial advice.
