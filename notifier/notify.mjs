/* notify.mjs — GitHub Actions entry point.
   Builds the digest and pushes it to LINE and/or Telegram.
   Run locally with:  node notifier/notify.mjs --dry   (prints instead of sending) */
import { readFile } from 'node:fs/promises';
import { buildDigest } from './digest.mjs';

const dry = process.argv.includes('--dry');
/* PowerShell can prepend a UTF-8 BOM (U+FEFF) when uploading a GitHub secret. A BOM in a
   token also breaks HTTP headers (must be bytes 0–255), so scrub every secret we read. */
const clean = s => {
  if (s == null) return s;
  s = String(s);
  while (s.length && (s.charCodeAt(0) === 0xFEFF || s.charCodeAt(0) === 0x200B)) s = s.slice(1);
  return s.trim();
};
/* Holdings come from the PORTFOLIO_JSON secret when running in GitHub Actions (keeps your
   financials OUT of the public repo). Falls back to the local portfolio.json for dry-runs
   and local/Task-Scheduler use. */
const rawCfg = process.env.PORTFOLIO_JSON
  ? process.env.PORTFOLIO_JSON
  : await readFile(new URL('./portfolio.json', import.meta.url), 'utf8');
const cfg = JSON.parse(clean(rawCfg));

/* weekend guard (markets closed). Manual runs (workflow_dispatch) and --dry bypass it so
   you can always fire a test. The scheduled cron still only sends Mon–Fri. */
const manual = process.argv.includes('--force') || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const wd = new Date().getUTCDay();
if (!dry && !manual && (wd === 0 || wd === 6)) { console.log('Weekend — skipping.'); process.exit(0); }

const d = await buildDigest(cfg);
console.log('--- digest ---\n' + d.text + '\n--------------');
if (dry) process.exit(0);

let sent = 0;
const LINE = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
if (LINE) {
  const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE}` },
    body: JSON.stringify({ messages: [{ type: 'text', text: d.text }] })
  });
  console.log('LINE:', r.status, r.ok ? 'sent' : await r.text());
  if (r.ok) sent++;
}
const TG = clean(process.env.TELEGRAM_BOT_TOKEN), TGC = clean(process.env.TELEGRAM_CHAT_ID);
if (TG && TGC) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TGC, text: d.text })
  });
  console.log('Telegram:', r.status, r.ok ? 'sent' : await r.text());
  if (r.ok) sent++;
}
if (!LINE && !(TG && TGC)) {
  console.log('No LINE_CHANNEL_ACCESS_TOKEN or TELEGRAM_* secrets set — nothing sent.');
  process.exit(1);
}
console.log(`Done — ${sent} channel(s) notified.`);
