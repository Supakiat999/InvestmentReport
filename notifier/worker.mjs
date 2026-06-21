/* worker.mjs — Cloudflare Worker version of the notifier.
   Three jobs in one:
     1. Cron (hourly, US market window): pushes the digest to LINE + Telegram.
     2. LINE webhook (/line): message your bot anything → instant digest reply.
        Replies are FREE on LINE — unlimited on-demand checks.
     3. Yahoo proxy (/yh?u=<url>): a private, always-up relay for TrackingStocks.html.
   Deploy:  wrangler deploy   (see SETUP.md) */
import { buildDigest } from './digest.mjs';

let cached = null, cachedAt = 0;

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
  if (env.PORTFOLIO_JSON) return JSON.parse(clean(env.PORTFOLIO_JSON));
  if (env.PORTFOLIO_URL) { const r = await fetch(env.PORTFOLIO_URL, { cf: { cacheTtl: 300 } }); return r.json(); }
  throw new Error('No PORTFOLIO_JSON secret set');
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
            /* any text message OR a rich-menu tap (postback) -> reply with the live report */
            if (!ev.replyToken || (ev.type !== 'message' && ev.type !== 'postback')) continue;
            const text = await digestText(env);
            const r = await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(env)}` },
              body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text }] })
            });
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
