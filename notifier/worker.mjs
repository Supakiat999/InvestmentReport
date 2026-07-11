/* worker.mjs — Cloudflare Worker version of the notifier.
   Three jobs in one:
     1. Cron (hourly, US market window): pushes the digest to LINE + Telegram.
     2. LINE webhook (/line): message your bot anything → instant digest reply.
        Replies are FREE on LINE — unlimited on-demand checks.
     3. Yahoo proxy (/yh?u=<url>): a private, always-up relay for TrackingStocks.html.
   Deploy:  wrangler deploy   (see SETUP.md) */
import { buildDigest, stockText, moodText, ideasText, cycleText, rankText, compareText } from './digest.mjs';
import { parseTrade, applyTrade, holdingsListText } from './holdings.mjs';

let cached = null, cachedAt = 0;

/* ---------- chat command routing ---------- */
const HELP = [
  '🤖 STOCK REPORT COMMANDS',
  '━━━━━━━━━━━━━',
  '• Send a ticker → instant analysis',
  '   e.g. NVDA · MSFT · PTT.BK',
  '• buy NVDA 5 @180 — record a buy',
  '• sell NVDA 2 (or: sell NVDA all)',
  '• holdings — list what you own',
  '• undo — revert your last edit',
  '• cycle — each holding\'s market stage',
  '• best / worst — your holdings ranked',
  '• compare NVDA AMD — side by side',
  '• mood — market fear/greed right now',
  "• ideas — strongest charts you don't own",
  '• report — full portfolio report',
  '(the menu buttons below work too)'
].join('\n');

/* ---------- holdings editing (owner-only, stored as a KV overlay on PORTFOLIO_JSON) ----------
   The first LINE user to issue an edit becomes the owner (the bot's only friend); every later
   edit must come from the same userId. This edits the bot's RECORDS — it never places orders. */
async function ownerOk(env, userId) {
  if (!env.HOLDINGS || !userId) return false;
  const owner = await env.HOLDINGS.get('owner');
  if (!owner) { await env.HOLDINGS.put('owner', userId); return true; }
  return owner === userId;
}
const getOverlay = async env => (env.HOLDINGS && await env.HOLDINGS.get('overlay', 'json')) || { holdings: {} };

async function handleTrade(env, userId, tr) {
  if (!env.HOLDINGS) return '⚠️ Holdings editing is not set up on this bot yet.';
  if (!await ownerOk(env, userId)) return '🔒 Only this bot\'s owner can edit holdings.';
  const cfg = await getCfg(env);
  const res = applyTrade(cfg.holdings, tr);
  if (res.error) return '❓ ' + res.error;
  const overlay = await getOverlay(env);
  await env.HOLDINGS.put('overlay_prev', JSON.stringify(overlay));
  overlay.holdings[tr.sym] = res.entry;          /* null = position closed */
  overlay.updated = new Date().toISOString();
  await env.HOLDINGS.put('overlay', JSON.stringify(overlay));
  cached = null; replyCache.clear();             /* the very next report reflects the edit */
  return res.summary + '\n(“undo” reverts · “holdings” lists · “report” shows the effect)';
}

async function handleUndo(env, userId) {
  if (!env.HOLDINGS) return '⚠️ Holdings editing is not set up on this bot yet.';
  if (!await ownerOk(env, userId)) return '🔒 Only this bot\'s owner can edit holdings.';
  const prev = await env.HOLDINGS.get('overlay_prev', 'json');
  if (!prev) return '❓ Nothing to undo yet.';
  const curr = await getOverlay(env);
  await env.HOLDINGS.put('overlay', JSON.stringify(prev));
  await env.HOLDINGS.put('overlay_prev', JSON.stringify(curr));   /* undo twice = redo */
  cached = null; replyCache.clear();
  return '↩️ Reverted the last holdings edit. (“undo” again = redo · “holdings” to check)';
}

/* tappable quick-reply buttons shown under every bot reply — one tap sends the command */
const QUICK = {
  items: [
    ['📊 Report', 'report'], ['🔄 Cycle', 'cycle'], ['🏆 Best', 'best'], ['⚠️ Worst', 'worst'],
    ['💼 Holdings', 'holdings'], ['🌡 Mood', 'mood'], ['💡 Ideas', 'ideas'], ['❓ Help', 'help']
  ].map(([label, text]) => ({ type: 'action', action: { type: 'message', label, text } }))
};

/* casual chat words must never be mistaken for ticker symbols ("hi" ≠ a stock) */
const CHATTER = new Set(['hi', 'hii', 'hello', 'hey', 'ho', 'yo', 'sup', 'ok', 'okay', 'k', 'kk',
  'thanks', 'thank', 'thx', 'ty', 'cool', 'nice', 'good', 'great', 'wow', 'lol', 'haha', '555',
  'hmm', 'huh', 'yes', 'yeah', 'no', 'nope', 'test', 'ping', 'start', 'menu', 'hallo', 'oi']);

const replyCache = new Map();   // normalized command -> { t, text } (5-min TTL, small cap)
async function routedReply(env, raw, userId) {
  const txt = String(raw || '').trim();
  const low = txt.toLowerCase().replace(/[!.?]+$/, '');
  if (!txt || low === 'report' || /report now/i.test(txt)) return digestText(env);
  if (low === 'help' || txt === '?' || CHATTER.has(low)) return HELP;
  /* holdings editing — never cached, owner-only */
  const tr = parseTrade(txt);
  if (tr) return handleTrade(env, userId, tr);
  if (low === 'undo') return handleUndo(env, userId);
  if (low === 'holdings' || low === 'portfolio' || low === 'port') {
    if (!await ownerOk(env, userId)) return '🔒 Only this bot\'s owner can view holdings.';
    const cfg = await getCfg(env);
    const o = await getOverlay(env);
    return holdingsListText(cfg.holdings, o.updated);
  }
  /* holdings-based analytics — owner-gated, always fresh (reflect the latest edits) */
  if (low === 'cycle' || low === 'cycles' || low === 'stage' || low === 'stages') {
    if (!await ownerOk(env, userId)) return '🔒 Only this bot\'s owner can view holdings.';
    return cycleText(await getCfg(env));
  }
  if (low === 'best' || low === 'top' || low === 'worst' || low === 'weak') {
    if (!await ownerOk(env, userId)) return '🔒 Only this bot\'s owner can view holdings.';
    return rankText(await getCfg(env), low === 'worst' || low === 'weak');
  }
  const hit = replyCache.get(low);
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.text;
  let out = null;
  const cmp = txt.match(/^(?:compare|vs)\s+([A-Za-z0-9.\-^=]{1,14})\s+(?:vs\s+)?([A-Za-z0-9.\-^=]{1,14})$/i);
  if (low === 'mood' || low === 'market') out = await moodText();
  else if (low === 'idea' || low === 'ideas') out = await ideasText(await getCfg(env));
  else if (cmp) out = await compareText(cmp[1], cmp[2]);
  else if (/^[a-z0-9.\-^=]{1,14}$/i.test(txt)) out = await stockText(txt, await getCfg(env));
  if (out == null) return digestText(env);   // multi-word chat → the full report, as before
  replyCache.set(low, { t: Date.now(), text: out });
  if (replyCache.size > 50) replyCache.delete(replyCache.keys().next().value);
  return out;
}

/* PowerShell/wrangler can prepend a BOM (U+FEFF) to a secret; scrub it (also breaks HTTP headers) */
const clean = s => {
  if (s == null) return s;
  s = String(s);
  while (s.length && (s.charCodeAt(0) === 0xFEFF || s.charCodeAt(0) === 0x200B)) s = s.slice(1);
  return s.trim();
};
const tok = env => clean(env.LINE_CHANNEL_ACCESS_TOKEN);

async function getCfg(env) {
  /* holdings live in a PRIVATE Worker secret — never in the public repo */
  let cfg;
  if (env.PORTFOLIO_JSON) cfg = JSON.parse(clean(env.PORTFOLIO_JSON));
  else if (env.PORTFOLIO_URL) { const r = await fetch(env.PORTFOLIO_URL, { cf: { cacheTtl: 300 } }); cfg = await r.json(); }
  else throw new Error('No PORTFOLIO_JSON secret set');
  /* chat edits (buy/sell commands) overlay the base: entry replaces, null deletes */
  try {
    if (env.HOLDINGS) {
      const o = await env.HOLDINGS.get('overlay', 'json');
      if (o && o.holdings) {
        cfg.holdings = { ...cfg.holdings };
        for (const [s, v] of Object.entries(o.holdings)) {
          if (v === null) delete cfg.holdings[s]; else cfg.holdings[s] = v;
        }
      }
    }
  } catch (e) { console.log('overlay merge failed:', String(e)); }
  return cfg;
}
async function digestText(env) {
  if (cached && Date.now() - cachedAt < 5 * 60e3) return cached;   // 5-min cache
  const d = await buildDigest(await getCfg(env));
  cached = d.text; cachedAt = Date.now();
  return d.text;
}
async function pushLINE(env, text) {
  if (!tok(env)) return;
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(env)}` },
    body: JSON.stringify({ messages: [{ type: 'text', text }] })
  });
}
async function pushTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
}
async function lineSigOk(env, body, sig) {
  const secret = clean(env.LINE_CHANNEL_SECRET);
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

export default {
  async scheduled(event, env, ctx) {
    const wd = new Date().getUTCDay();
    if (wd === 0 || wd === 6) return;
    const text = await digestText(env);
    ctx.waitUntil(Promise.all([pushLINE(env, text), pushTelegram(env, text)]));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    /* LINE webhook: reply to any message with the digest (replies are free/unlimited) */
    if (url.pathname === '/line' && req.method === 'POST') {
      const body = await req.text();
      if (!await lineSigOk(env, body, req.headers.get('x-line-signature'))) return new Response('bad sig', { status: 403 });
      const j = JSON.parse(body);
      ctx.waitUntil((async () => {
        try {
          console.log('webhook events:', (j.events || []).map(e => e.type).join(','));
          for (const ev of j.events || []) {
            /* text messages are routed as commands (ticker / mood / ideas / help / report);
               postbacks and non-text messages get the full report */
            if (!ev.replyToken || (ev.type !== 'message' && ev.type !== 'postback')) continue;
            const text = (ev.type === 'message' && ev.message && ev.message.type === 'text')
              ? await routedReply(env, ev.message.text, ev.source && ev.source.userId)
              : await digestText(env);
            /* stock replies get a tappable "Open chart" button pointing at their deep link */
            const deep = text.match(/https:\/\/\S+#t=[A-Za-z0-9.\-^=%]+/);
            const quick = deep
              ? { items: [{ type: 'action', action: { type: 'uri', label: '📈 Open chart', uri: deep[0] } }, ...QUICK.items] }
              : QUICK;
            const send = q => fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(env)}` },
              body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text, quickReply: q }] })
            });
            let r = await send(quick);
            if (!r.ok && r.status === 400 && deep) r = await send(QUICK);   /* uri item rejected → plain buttons */
            if (!r.ok) console.log('LINE reply HTTP', r.status, (await r.text()).slice(0, 300));
            else console.log('LINE reply ok, text len', text.length);
          }
        } catch (e) { console.log('webhook handler error:', (e && e.stack) || String(e)); }
      })());
      return new Response('ok');
    }

    /* nothing else is public: the digest is private (holdings) and only goes out
       via the signature-verified LINE webhook above and the hourly broadcast. */
    return new Response('Stock Report bot — webhook only', { status: 200 });
  }
};
