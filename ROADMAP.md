# Stock Report — Improvement Roadmap

> Prioritized, self-contained work items. Each has files-to-touch and acceptance criteria so any
> engineer (or Claude session) can pick one up cold. Read `CLAUDE.md` first for guardrails.
> Status: written 2026-07-09, after Round 4 (chat commands, deep links, value history) shipped.

## Current UX audit — why these priorities

The tracker is feature-rich but **dense**. On a phone (where it's opened from the LINE menu):
- The dashboard stacks 12+ cards on one tab (help, brief, snapshot, stats, Action Center,
  watchlist, details, news, recommendation, plan, reasoning, backtest, ideas, quick-add).
  First-time users don't know where to look.
- Tapping a stock populates the **Details card somewhere below** — you must scroll to find it,
  and scroll back up to pick the next stock. This is the single most common flow, and it's the
  clumsiest. (Biggest win available.)
- Small tap targets: the ▸ expand caret, ✕ remove, and sort headers are finger-hostile.
- Data freshness needs a trip to the swipeable toolbar (↻); phones expect pull-to-refresh and
  refresh-on-reopen.
- Holdings/settings live in each browser's localStorage — the phone PWA and desktop browser
  silently diverge. Export/Import exists but is manual and hidden.
- On LINE, replies are plain text; buttons (Flex Messages) would cut typing.

## Tier 1 — quick usability wins (small, high value)

### 1.1 Mobile detail bottom-sheet  ⭐ biggest single UX win
Tapping a stock row on ≤600px should open the existing `#detail` card content as a **slide-up
sheet** (fixed overlay, drag/✕ to close) instead of populating a card far down the page.
- Touch: `TrackingStocks.html` — `select()` (mobile branch), a `.sheet` CSS block, small
  open/close helpers; reuse the already-rendered `#detail` node (move it into the sheet
  container on open, back on close — don't re-render).
- Accept: on 375px, tap row → sheet slides up with full detail; ✕ or swipe-down closes and the
  list scroll position is preserved; desktop unchanged.

### 1.2 Bigger tap targets
▸ caret, ✕ remove, sort headers, D/W/M/Y chips: give ≥40×40px hit areas (padding, not layout
shift) on ≤600px.
- Touch: CSS only.
- Accept: all row controls comfortably tappable; no layout jump vs today.

### 1.3 Refresh that matches phone habits
(a) On `visibilitychange` → if data older than ~10 min, silent `refreshAll(true)` — so reopening
the PWA/LINE browser always shows fresh numbers. (b) Simple pull-to-refresh at scroll-top on
mobile (touchstart/touchmove overscroll → spinner → `refreshAll()`).
- Touch: `TrackingStocks.html` init section + small CSS.
- Accept: background the app 10+ min, reopen → quotes auto-update; pull down at top → refresh.

### 1.4 Search box can add tickers
When the watchlist filter matches nothing but looks like a symbol, show one row:
“➕ Add ‘NVDA’ to watchlist” → `quickAdd()`.
- Touch: `renderWatchlist()` empty-result branch.
- Accept: type an untracked symbol → one tap adds and loads it.

### 1.5 Simple view toggle
A “Simple” switch on the watchlist card (persisted in state) hiding RSI/Yield/1M/signals
columns on mobile — just Ticker · Price · Day% · verdict chip. Default ON for first-time
mobile visitors.
- Touch: `renderWatchlist()` + one state flag.
- Accept: toggle hides/shows columns instantly; choice persists.

## Tier 2 — structure & navigation

### 2.1 Bottom navigation bar (mobile)
Thumb-zone fixed bar with the 4 tabs (+ scroll-to-top on re-tap). Keep the sticky top tabs on
desktop only.
- Touch: HTML nav clone + CSS (`≤600px`), `switchTab` unchanged.
- Accept: tabs reachable one-handed; content not obscured (safe-area padding).

### 2.2 Dashboard declutter
On mobile, secondary cards (News, Backtest, full Reasoning, Quick-add) become collapsed
accordions (`<details>`), default-closed; card order: snapshot → Action Center → watchlist →
detail → everything else.
- Touch: wrap existing cards; no logic changes.
- Accept: first screen on mobile = snapshot + actions + list; nothing lost, just folded.

### 2.3 First-run onboarding card
Replace the “❓ New here?” details with a 3-step dismissible card on first visit
(1 add stocks → 2 tap a row to see why → 3 enter shares to unlock Portfolio; plus the 🔐
unlock hint for the owner).
- Touch: one render function + `state.onboarded` flag.
- Accept: shows once, dismiss persists, never shows again.

### 2.4 Device sync helper
The phone and desktop diverge (localStorage). Add “📤 Sync devices” in the toolbar: shows a QR
of the existing export JSON (small enough) or a copyable blob, and an import drop on the other
device. No server, no new privacy surface.
- Touch: reuse `exportData()`/`importData()`; add QR via tiny inline generator (no CDN — CSP/PWA).
- Accept: holdings moved phone↔desktop in <30s without a file manager.

## Tier 3 — LINE upgrades

### 3.1 Flex Message stock replies
Upgrade `stockText` replies to a LINE Flex bubble: header (SYM · price · day%), verdict chips
row, and **buttons** (“Full analysis” → `#t=SYM`, “Market mood”, “Report”). Plain-text fallback
stays for notifiers.
- Touch: `notifier/worker.mjs` (reply `messages` array), new `stockFlex()` in `digest.mjs`.
- Accept: sending `NVDA` returns a card with tappable buttons; `--dry` output unchanged.

### 3.2 Alerts from chat (needs storage)
`alert NVDA > 200` → store in **Workers KV** (free tier) keyed by user; the hourly digest and a
worker cron check them; `alerts` lists, `alert clear NVDA` removes. First feature needing state
on the worker — keep KV values holdings-free (symbols + thresholds only).
- Touch: `wrangler.jsonc` (KV binding), worker routing, digest alert merge.
- Accept: set/list/clear from chat; triggered alert appears in the next report.

### 3.3 `compare A B` command — ✅ DONE 2026-07-10
Shipped together with cycle-stage tracking (`cycle`, `best`, `worst` commands) and the expanded
indicator set (Bollinger %B, Stochastic %K, 50/200 cross, support/resistance, trail stop).

### 3.4 Hourly push noise control
Env-var thresholds: skip the hourly broadcast when |today's move| < X% AND no alerts AND no
verdict flips (reply-on-demand is always available). Cuts message fatigue and quota use.
- Touch: `.github/workflows/notify.yml` env + `notify.mjs` gate.
- Accept: quiet days → fewer pushes; `--dry` prints “would skip (quiet)”.

## Tier 4 — larger bets (design first)

- **4.1 Thai language toggle** — full TH/EN i18n of tracker labels + LINE replies. High value for
  the owner’s family; large string-extraction pass.
- **4.2 Performance pass** — the page renders all cards eagerly (~3k lines, one file). Defer
  news/ideas/backtest until visible (IntersectionObserver); target <2s first paint in the LINE
  in-app browser on 4G.
- **4.3 Earnings awareness** — next earnings date in stock replies and as an Action Center
  “heads-up” row (Yahoo `quoteSummary` via relays; verify reliability first).
- **4.4 Multi-user LINE** — per-user portfolios via KV keyed on LINE userId; only if the bot is
  ever shared beyond the owner. Big privacy design required.

## Non-goals (decided, don't revisit without new info)
- Alert-triggered LINE **pushes** outside the hourly window (free-tier quota ~300/mo; hourly
  already uses most of it — replies are the free path).
- Renaming localStorage keys (`longview-v2`, `longview-cache-v1`) — would wipe user data.
- Server-side portfolio storage — the no-plaintext-holdings-in-cloud rule stands.

## Definition of done (every item)
1. Verified in the local preview (`.claude/launch.json` static server) at 375px AND desktop width.
2. Zero console errors; existing flows (deep links, passcode unlock, expand rows) still pass.
3. `node notifier/notify.mjs --dry` still renders when notifier files were touched; worker
   redeployed if `digest.mjs`/`worker.mjs` changed.
4. Committed with the privacy checklist from `CLAUDE.md` (no holdings, no secrets).
