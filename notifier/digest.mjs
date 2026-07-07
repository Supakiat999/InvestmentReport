/* digest.mjs — shared engine for the hourly notifier.
   Used by notify.mjs (GitHub Actions) and worker.mjs (Cloudflare Worker).
   Fetches Yahoo Finance directly (no CORS in the cloud), computes the same
   indicators as the Longview tracker, and formats a compact phone message. */

const Y = 'https://query1.finance.yahoo.com';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

/* candidates for "ideas you don't own" — same universe as the tracker's scanner */
export const IDEAS = ['LLY','UNH','JNJ','ABBV','V','MA','JPM','SPGI','COST','WMT','PG','KO',
  'XOM','CVX','CAT','LIN','HD','ORCL','CRM','ADBE','NFLX','ASML','AVGO','VIG',
  'MCD','PEP','ABT','HON','NEE','UNP'];

/* ---------- data ---------- */
async function sparkFetch(symbols, range = '1y', chunk = 8) {
  const out = {};
  for (let i = 0; i < symbols.length; i += chunk) {
    const syms = symbols.slice(i, i + chunk);
    const url = `${Y}/v8/finance/spark?symbols=${encodeURIComponent(syms.join(','))}&range=${range}&interval=1d`;
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.spark && j.spark.result) {
        for (const it of j.spark.result) {
          const resp = it.response && it.response[0];
          if (resp) out[it.symbol] = { timestamp: resp.timestamp, close: resp.indicators.quote[0].close };
        }
      } else if (j && typeof j === 'object') {
        for (const k in j) if (j[k] && j[k].close) out[k] = j[k];
      }
    } catch (e) { /* ticker missing from one chunk → retried implicitly next hour */ }
  }
  for (const s in out) {
    const cl = [], ts = [];
    const e = out[s];
    for (let i = 0; i < e.close.length; i++) if (e.close[i] != null) { cl.push(e.close[i]); ts.push(e.timestamp[i]); }
    out[s] = { closes: cl, times: ts };
  }
  return out;
}

/* ---------- indicators (same math as the tracker) ---------- */
const sma = (a, n) => a.length < n ? null : a.slice(-n).reduce((x, y) => x + y, 0) / n;
function rsi14(c) {
  if (c.length < 15) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; }
  let ag = g / 14, al = l / 14;
  for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * 13 + (d > 0 ? d : 0)) / 14; al = (al * 13 + (d < 0 ? -d : 0)) / 14; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function macdHist(c) {
  if (c.length < 35) return null;
  const ema = (a, n) => { const k = 2 / (n + 1); let e = null; const o = []; for (const v of a) { e = e == null ? v : v * k + e * (1 - k); o.push(e); } return o; };
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = c.map((_, i) => e12[i] - e26[i]);
  const sig = ema(line, 9);
  return line[line.length - 1] - sig[sig.length - 1];
}
const clamp = x => Math.max(0, Math.min(100, x));
const ret = (c, n) => c.length > n ? (c[c.length - 1] / c[c.length - 1 - n] - 1) * 100 : null;

export function verdicts(c) {
  const px = c[c.length - 1];
  const rsi = rsi14(c), s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), mh = macdHist(c);
  const r1m = ret(c, 21), r1y = ret(c, 252) ?? ret(c, c.length - 1);
  const w52 = c.slice(-252), hi = Math.max(...w52), lo = Math.min(...w52);
  const pos = (px - lo) / ((hi - lo) || 1) * 100;
  let st = 50, lt = 50;
  if (rsi != null) st += rsi > 70 ? -15 : rsi >= 55 ? 12 : rsi >= 45 ? 0 : rsi >= 30 ? -10 : 8;
  if (s20 != null) st += px > s20 ? 10 : -10;
  if (mh != null) st += mh > 0 ? 12 : -12;
  if (r1m != null) st += r1m > 8 ? 5 : r1m > 0 ? 4 : r1m > -8 ? -4 : -8;
  if (s200 != null) lt += px > s200 ? 20 : -20;
  if (s50 != null && s200 != null) lt += s50 > s200 ? 12 : -12;
  lt += pos > 85 ? 6 : pos >= 50 ? 4 : pos >= 15 ? -4 : -8;
  if (r1y != null) lt += r1y > 15 ? 8 : r1y > 0 ? 4 : r1y > -15 ? -6 : -10;
  const word = s => s >= 68 ? 'BUY' : s >= 56 ? 'LEAN BUY' : s > 44 ? 'HOLD' : s >= 33 ? 'REDUCE' : 'SELL';
  st = clamp(st); lt = clamp(lt);
  return { st, lt, stWord: word(st), ltWord: word(lt), rsi, px };
}

export function moodOf(M) {
  const spy = M['SPY'], vix = M['^VIX'], tlt = M['TLT'], hyg = M['HYG'];
  if (!spy || spy.closes.length < 130) return null;
  const last = x => x.closes[x.closes.length - 1];
  const r20 = x => x && x.closes.length > 21 ? (last(x) / x.closes[x.closes.length - 22] - 1) * 100 : null;
  const comps = [];
  const s125 = sma(spy.closes, 125);
  if (s125) comps.push(clamp(50 + (last(spy) / s125 - 1) * 100 * 5));
  if (vix && vix.closes.length > 55) {
    const v50 = sma(vix.closes, 50);
    comps.push((clamp(100 - (last(vix) - 10) * (80 / 30)) + clamp(50 - (last(vix) / v50 - 1) * 100 * 2)) / 2);
  }
  if (r20(spy) != null && r20(tlt) != null) comps.push(clamp(50 + (r20(spy) - r20(tlt)) * 4));
  if (r20(hyg) != null && r20(tlt) != null) comps.push(clamp(50 + (r20(hyg) - r20(tlt)) * 6));
  const rsi = rsi14(spy.closes);
  if (rsi != null) comps.push(clamp((rsi - 30) * 2.5));
  if (!comps.length) return null;
  const score = comps.reduce((a, b) => a + b, 0) / comps.length;
  const label = score < 25 ? 'EXTREME FEAR' : score < 45 ? 'Fear' : score <= 55 ? 'Neutral' : score < 75 ? 'Greed' : 'EXTREME GREED';
  return { score: Math.round(score), label, vix: vix ? +last(vix).toFixed(1) : null };
}

/* ---------- the digest ---------- */
export async function buildDigest(cfg) {
  const fmt = (n, dp = 0) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sgn = (n, dp = 2) => (n >= 0 ? '+' : '') + fmt(n, dp);
  const holdSyms = Object.keys(cfg.holdings);
  const watchSyms = cfg.watchlist || [];
  const curs = [...new Set(Object.values(cfg.holdings).map(h => h.currency === 'GBp' ? 'GBP' : h.currency).filter(c => c !== 'USD'))];
  if (cfg.baseCur && cfg.baseCur !== 'USD') curs.push(cfg.baseCur);
  const fxSyms = [...new Set(curs)].map(c => c + 'USD=X');
  const ideaSyms = IDEAS.filter(s => !holdSyms.includes(s) && !watchSyms.includes(s));

  const D = await sparkFetch([...holdSyms, ...watchSyms, ...fxSyms, 'SPY', '^VIX', 'TLT', 'HYG'], '1y', 8);
  const I = await sparkFetch(ideaSyms, '1y', 8);

  const fx = {};
  for (const c of [...new Set(curs)]) { const d = D[c + 'USD=X']; if (d) fx[c] = d.closes[d.closes.length - 1]; }
  const toUSD = c => c === 'USD' ? 1 : c === 'GBp' ? (fx['GBP'] || null) / 100 : fx[c] || null;
  const base = cfg.baseCur || 'USD';
  const conv = (amt, c) => { const a = toUSD(c), b = toUSD(base); return a != null && b != null ? amt * a / b : null; };

  /* portfolio totals + movers + per-holding verdicts */
  let val = 0, cost = 0, day = 0, missing = [];
  const movers = [], weak = [];
  for (const s of holdSyms) {
    const h = cfg.holdings[s], d = D[s];
    if (!d || d.closes.length < 5) { missing.push(s); continue; }
    const px = d.closes[d.closes.length - 1], prev = d.closes[d.closes.length - 2];
    const v = conv(h.shares * px, h.currency);
    if (v == null) { missing.push(s); continue; }
    val += v;
    cost += conv(h.shares * h.cost, h.currency) || 0;
    day += conv(h.shares * (px - prev), h.currency) || 0;
    const chg = (px / prev - 1) * 100;
    movers.push({ s, chg });
    if (d.closes.length > 60) { const v2 = verdicts(d.closes); if (v2.lt <= 42) weak.push({ s, word: v2.ltWord, lt: v2.lt }); }
  }
  movers.sort((a, b) => b.chg - a.chg);
  const cashB = (conv(cfg.cashTHB || 0, 'THB') || 0) + (conv(cfg.cashUSD || 0, 'USD') || 0);
  const untrkB = conv(cfg.untrackedTHB || 0, 'THB') || 0;
  const grand = val + cashB + untrkB;

  /* alerts */
  const alerts = [];
  for (const s in (cfg.alerts || {})) {
    const a = cfg.alerts[s], d = D[s];
    if (!d) continue;
    const px = d.closes[d.closes.length - 1];
    if (a.above && px >= a.above) alerts.push(`${s} ≥ ${a.above} (now ${fmt(px, 2)})`);
    if (a.below && px <= a.below) alerts.push(`${s} ≤ ${a.below} (now ${fmt(px, 2)})`);
  }

  /* watchlist signals */
  const watchLines = [];
  for (const s of watchSyms) {
    const d = D[s];
    if (d && d.closes.length > 60) { const v = verdicts(d.closes); watchLines.push(`${s} ${v.stWord}/${v.ltWord}`); }
  }

  /* market mood + ideas */
  const mood = moodOf(D);
  const ideas = ideaSyms.map(s => I[s] && I[s].closes.length > 200 ? { s, v: verdicts(I[s].closes) } : null)
    .filter(Boolean).sort((a, b) => (b.v.lt * 2 + b.v.st) - (a.v.lt * 2 + a.v.st)).slice(0, 8);

  /* compose — sectioned & numbered, plain text (LINE has no markdown) */
  const sym = base === 'THB' ? '฿' : base === 'USD' ? '$' : base + ' ';
  const th = new Date(Date.now() + 7 * 3600e3);
  const hhmm = `${String(th.getUTCHours()).padStart(2, '0')}:${String(th.getUTCMinutes()).padStart(2, '0')}`;
  const RULE = '━━━━━━━━━━━━━';
  /* a section = blank line + title + indented body; returns '' when empty so it's skipped */
  const section = (title, lines) => (lines && lines.length) ? ['', title, ...lines].join('\n') : '';

  const winners = movers.slice(0, 5).filter(m => m.chg > 0);
  const losers = movers.slice(-5).reverse().filter(m => m.chg < 0 && !winners.includes(m));

  /* 🎯 Do now — only the few actions that matter most: alerts → weakest holdings → best idea */
  const weakSorted = [...weak].sort((a, b) => a.lt - b.lt);
  const doNow = [];
  if (alerts.length) doNow.push(`Check alert: ${alerts[0]}${alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}`);
  for (const w of weakSorted.slice(0, 2)) if (w.lt <= 33 && doNow.length < 3) doNow.push(`Review ${w.s} — chart says ${w.word} (${w.lt}/100 long-term)`);
  if (doNow.length < 3 && ideas.length && ideas[0].v.lt >= 85) doNow.push(`Research ${ideas[0].s} — strongest chart you don't own (${ideas[0].v.lt}/100)`);

  const head = [
    `📊 STOCK REPORT · ${hhmm} TH`,
    RULE,
    `💼 ${sym}${fmt(grand)} · today ${sgn(day, 0)} (${val ? sgn(day / val * 100, 2) : '—'}%)`,
    `📈 Total P/L ${sgn(val - cost, 0)} (${cost ? sgn((val - cost) / cost * 100, 1) : '—'}%)`
  ];
  if (mood) head.push(`🌡 Market ${mood.score} ${mood.label}${mood.vix != null ? ` · VIX ${mood.vix}` : ''}`);
  if (alerts.length) head.push(`🔔 ALERT: ${alerts.join(' | ')}`);

  const body = [
    section('🎯 Do now', doNow.map((a, i) => ` ${i + 1} ${a}`)),
    section('🏆 Winners', winners.map((m, i) => ` ${i + 1} ${m.s} ${sgn(m.chg, 1)}%`)),
    section('💔 Losers', losers.map((m, i) => ` ${i + 1} ${m.s} ${sgn(m.chg, 1)}%`)),
    section('⚠️ Weak charts', weakSorted.slice(0, 8).map(w => ` • ${w.s} ${w.word} ${w.lt}`)),
    section('💡 Ideas (not owned)', ideas.length ? [' • ' + ideas.map(i => `${i.s} ${i.v.lt}`).join(' · ')] : null),
    section('📌 Watching', watchLines.length ? [' • ' + watchLines.slice(0, 6).join(' · ')] : null)
  ].filter(Boolean);

  const text = [
    head.join('\n'),
    ...body,
    '', RULE, 'chart signals only · not advice',
    ...(missing.length ? [`(no data: ${missing.join(',')})`] : [])
  ].join('\n');
  return { text, grand, day, mood, alerts };
}
