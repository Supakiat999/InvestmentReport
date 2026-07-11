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

/* Bollinger %B (20, 2σ): <0 below lower band (washed out), 0–1 inside, >1 above upper (stretched) */
function bollingerPB(c) {
  if (c.length < 20) return null;
  const w = c.slice(-20), m = w.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  return sd ? (c[c.length - 1] - (m - 2 * sd)) / (4 * sd) : null;
}
/* Stochastic %K(14) on closes: <20 oversold, >80 overbought */
function stochK(c) {
  if (c.length < 14) return null;
  const w = c.slice(-14), hi = Math.max(...w), lo = Math.min(...w);
  return hi > lo ? (c[c.length - 1] - lo) / (hi - lo) * 100 : null;
}
/* most recent 50/200-day golden or death cross within ~60 sessions */
function crossInfo(c) {
  if (c.length < 261) return null;
  const sAt = (n, i) => { let s = 0; for (let k = c.length - i - n; k < c.length - i; k++) s += c[k]; return s / n; };
  const now = sAt(50, 0) - sAt(200, 0) > 0;
  for (let i = 1; i <= 60; i++) {
    if ((sAt(50, i) - sAt(200, i) > 0) !== now) return { type: now ? 'golden' : 'death', daysAgo: i };
  }
  return null;
}
/* Weinstein stage analysis on the ~150-day average: the stock's position in its cycle */
export function stageOf(c) {
  if (c.length < 171) return null;
  const N = 150;
  const maAt = i => { let s = 0; for (let k = c.length - i - N; k < c.length - i; k++) s += c[k]; return s / N; };
  const ma = maAt(0), px = c[c.length - 1];
  const slope20 = (ma / maAt(20) - 1) * 100;
  const slope60 = c.length >= N + 61 ? (ma / maAt(60) - 1) * 100 : slope20;
  const above = px > ma;
  if (above && slope20 > 1) return { n: 2, emoji: '🟢', name: 'Uptrend (markup)', why: 'price above a rising 150-day average — the stage trend-followers want to own' };
  if (!above && slope20 < -1) return { n: 4, emoji: '🔴', name: 'Downtrend (markdown)', why: 'price below a falling 150-day average — the stage where big losses happen' };
  if (slope60 <= 0) return { n: 1, emoji: '🟡', name: 'Base (accumulation)', why: 'the long average flattened after a decline — watch for a breakout above it' };
  return { n: 3, emoji: '🟠', name: 'Topping (distribution)', why: 'the long average is flattening after an advance — tighten stops, be slow to add' };
}
/* simple 60-day support / resistance + an ATR-style trailing stop (3× avg daily move below the 22d high) */
function levelsOf(c) {
  if (c.length < 60) return null;
  const w = c.slice(-60);
  let vol = 0; const v = c.slice(-15);
  for (let i = 1; i < v.length; i++) vol += Math.abs(v[i] - v[i - 1]);
  vol /= (v.length - 1);
  return { sup: Math.min(...w), res: Math.max(...w), trail: Math.max(...c.slice(-22)) - 3 * vol };
}

export function verdicts(c) {
  const px = c[c.length - 1];
  const rsi = rsi14(c), s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), mh = macdHist(c);
  const r1m = ret(c, 21), r1y = ret(c, 252) ?? ret(c, c.length - 1);
  const w52 = c.slice(-252), hi = Math.max(...w52), lo = Math.min(...w52);
  const pos = (px - lo) / ((hi - lo) || 1) * 100;
  const pb = bollingerPB(c), k = stochK(c), cross = crossInfo(c), stage = stageOf(c);
  let st = 50, lt = 50;
  if (rsi != null) st += rsi > 70 ? -15 : rsi >= 55 ? 12 : rsi >= 45 ? 0 : rsi >= 30 ? -10 : 8;
  if (s20 != null) st += px > s20 ? 10 : -10;
  if (mh != null) st += mh > 0 ? 12 : -12;
  if (r1m != null) st += r1m > 8 ? 5 : r1m > 0 ? 4 : r1m > -8 ? -4 : -8;
  if (pb != null) st += pb > 1 ? -8 : pb > 0.8 ? -4 : pb < 0 ? 6 : pb < 0.2 ? 4 : 0;      /* Bollinger stretch/washout */
  if (k != null) st += k > 80 ? -6 : k < 20 ? 6 : 0;                                       /* stochastic extremes */
  if (s200 != null) lt += px > s200 ? 20 : -20;
  if (s50 != null && s200 != null) lt += s50 > s200 ? 12 : -12;
  lt += pos > 85 ? 6 : pos >= 50 ? 4 : pos >= 15 ? -4 : -8;
  if (r1y != null) lt += r1y > 15 ? 8 : r1y > 0 ? 4 : r1y > -15 ? -6 : -10;
  if (cross) lt += cross.type === 'golden' ? 8 : -8;                                       /* fresh 50/200 cross */
  if (stage) lt += stage.n === 2 ? 6 : stage.n === 4 ? -6 : 0;                             /* cycle stage */
  const word = s => s >= 68 ? 'BUY' : s >= 56 ? 'LEAN BUY' : s > 44 ? 'HOLD' : s >= 33 ? 'REDUCE' : 'SELL';
  st = clamp(st); lt = clamp(lt);
  return { st, lt, stWord: word(st), ltWord: word(lt), rsi, px, pb, k, cross, stage, pos };
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

/* ---------- chat commands (worker webhook replies) ---------- */
const SITE = 'https://supakiat999.github.io/InvestmentReport/TrackingStocks.html';
const RULE2 = '━━━━━━━━━━━━━';
const fmtN = (n, dp = 2) => n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const sgnN = (n, dp = 2) => (n >= 0 ? '+' : '') + fmtN(n, dp);

/* "NVDA" / "PTT.BK" → one-stock analysis with cycle stage, indicators, levels + deep link */
export async function stockText(symRaw, cfg) {
  const sym = String(symRaw || '').trim().toUpperCase();
  const D = await sparkFetch([sym], '2y', 8);   /* 2y so the 50/200 cross has history */
  const d = D[sym];
  if (!d || d.closes.length < 30)
    return `❓ I don't know a stock called "${sym}".\nIf you meant a stock, send its Yahoo symbol — Thai stocks need .BK (PTT.BK), US stocks are plain (NVDA).\nOr just tap a button below 👇`;
  const c = d.closes;
  const v = verdicts(c);
  const px = c[c.length - 1], prev = c[c.length - 2];
  const day = (px / prev - 1) * 100;
  const r1m = ret(c, 21), r1y = ret(c, 252) ?? ret(c, c.length - 1);
  const mh = macdHist(c);
  const lv = levelsOf(c);
  const rsiWord = v.rsi == null ? '' : v.rsi > 70 ? ' (overbought)' : v.rsi < 30 ? ' (oversold)' : '';
  const kWord = v.k == null ? '' : v.k > 80 ? ' (overbought)' : v.k < 20 ? ' (oversold)' : '';
  const pbWord = v.pb == null ? '—' : v.pb > 1 ? 'above upper band (stretched)' : v.pb < 0 ? 'below lower band (washed out)' : `${fmtN(v.pb * 100, 0)}% of band`;
  const L = [
    `📊 ${sym}`,
    RULE2,
    `💵 ${fmtN(px)} · today ${sgnN(day)}%`,
    `📈 1M ${r1m != null ? sgnN(r1m, 1) : '—'}% · 1Y ${r1y != null ? sgnN(r1y, 1) : '—'}%`
  ];
  if (v.stage) L.push('', `🔄 Cycle: Stage ${v.stage.n} ${v.stage.emoji} ${v.stage.name}`, `   ${v.stage.why}`);
  L.push('', '🔎 Indicators',
    ` • RSI ${v.rsi != null ? fmtN(v.rsi, 0) : '—'}${rsiWord} · Stoch ${v.k != null ? fmtN(v.k, 0) : '—'}${kWord}`,
    ` • MACD ${mh == null ? '—' : mh > 0 ? '▲ rising' : '▼ falling'} · Bollinger ${pbWord}`,
    ` • 52w range: ${fmtN(v.pos, 0)}%${v.cross ? ` · ${v.cross.type === 'golden' ? '✨ golden' : '☠️ death'} cross ${v.cross.daysAgo}d ago` : ''}`);
  if (lv) L.push('', '📏 Levels',
    ` • support ~${fmtN(lv.sup)} · resistance ~${fmtN(lv.res)}`,
    ` • trail stop ~${fmtN(lv.trail)} (exit guide if it closes below)`);
  L.push('',
    `📅 Weeks: ${v.stWord} ${v.st}/100`,
    `🏛 Months+: ${v.ltWord} ${v.lt}/100`);
  const h = cfg && cfg.holdings && cfg.holdings[sym];
  if (h && h.shares > 0) {
    const pl = h.cost > 0 ? (px / h.cost - 1) * 100 : null;
    L.push('', `💼 You own ${fmtN(h.shares, h.shares % 1 ? 2 : 0)} sh${pl != null ? ` · P/L ${sgnN(pl, 1)}%` : ''}`);
  }
  L.push('', `Full analysis (chart · plan · why):`, `${SITE}#t=${encodeURIComponent(sym)}`, RULE2, 'chart signals only · not advice');
  return L.join('\n');
}

/* "cycle" → every holding's stage in the market cycle, grouped worst-last */
export async function cycleText(cfg) {
  const syms = Object.keys((cfg && cfg.holdings) || {});
  if (!syms.length) return '💼 No holdings recorded — "buy SYM QTY @PRICE" adds one.';
  const D = await sparkFetch(syms, '1y', 8);
  const groups = { 2: [], 3: [], 1: [], 4: [] }, missing = [];
  for (const s of syms) {
    const d = D[s];
    const st = d && d.closes.length >= 171 ? stageOf(d.closes) : null;
    if (st) groups[st.n].push(s); else missing.push(s);
  }
  const G = (n, title, tip) => groups[n].length ? ['', `${title} (${groups[n].length})`, ` ${groups[n].join(' · ')}`, ` ↳ ${tip}`] : [];
  return [
    '🔄 STOCK CYCLES — your holdings', RULE2,
    ...G(2, '🟢 Stage 2 · Uptrend', 'the stage to own — ride the trend'),
    ...G(3, '🟠 Stage 3 · Topping', 'tighten stops, be slow to add'),
    ...G(1, '🟡 Stage 1 · Base', 'watch for a breakout above the 150-day avg'),
    ...G(4, '🔴 Stage 4 · Downtrend', 'the risky stage — review these first'),
    ...(missing.length ? ['', `(not enough data: ${missing.join(', ')})`] : []),
    '', 'stage = price vs its 150-day average (Weinstein method)',
    RULE2, 'chart signals only · not advice'
  ].join('\n');
}

/* "best" / "worst" → your holdings ranked by long-term score */
export async function rankText(cfg, worst) {
  const syms = Object.keys((cfg && cfg.holdings) || {});
  if (!syms.length) return '💼 No holdings recorded — "buy SYM QTY @PRICE" adds one.';
  const D = await sparkFetch(syms, '1y', 8);
  const ranked = syms.map(s => D[s] && D[s].closes.length > 60 ? { s, v: verdicts(D[s].closes) } : null)
    .filter(Boolean).sort((a, b) => worst ? a.v.lt - b.v.lt : b.v.lt - a.v.lt).slice(0, 5);
  if (!ranked.length) return '❓ No data right now — try again in a minute.';
  return [
    worst ? '⚠️ WEAKEST HOLDINGS (long-term)' : '🏆 STRONGEST HOLDINGS (long-term)', RULE2,
    ...ranked.map((x, i) => ` ${i + 1} ${x.s} — ${x.v.ltWord} ${x.v.lt}/100${x.v.stage ? ` · ${x.v.stage.emoji} S${x.v.stage.n}` : ''}`),
    '', worst ? 'Review these first — send a ticker for the full picture.' : 'Send a ticker for the full picture.',
    RULE2, 'chart signals only · not advice'
  ].join('\n');
}

/* "compare A B" → side-by-side */
export async function compareText(aRaw, bRaw) {
  const A = String(aRaw || '').trim().toUpperCase(), B = String(bRaw || '').trim().toUpperCase();
  const D = await sparkFetch([A, B], '2y', 8);
  const bad = [A, B].filter(s => !D[s] || D[s].closes.length < 30);
  if (bad.length) return `❓ Couldn't find ${bad.join(' and ')} — use Yahoo symbols (Thai stocks need .BK).`;
  const va = verdicts(D[A].closes), vb = verdicts(D[B].closes);
  const ca = D[A].closes, cb = D[B].closes;
  const day = c => (c[c.length - 1] / c[c.length - 2] - 1) * 100;
  const row = (label, fa, fb) => `${label}: ${fa} | ${fb}`;
  return [
    `⚖️ ${A} vs ${B}`, RULE2,
    row('today', sgnN(day(ca), 1) + '%', sgnN(day(cb), 1) + '%'),
    row('1M', ret(ca, 21) != null ? sgnN(ret(ca, 21), 1) + '%' : '—', ret(cb, 21) != null ? sgnN(ret(cb, 21), 1) + '%' : '—'),
    row('1Y', ret(ca, 252) != null ? sgnN(ret(ca, 252), 1) + '%' : '—', ret(cb, 252) != null ? sgnN(ret(cb, 252), 1) + '%' : '—'),
    row('RSI', va.rsi != null ? fmtN(va.rsi, 0) : '—', vb.rsi != null ? fmtN(vb.rsi, 0) : '—'),
    row('cycle', va.stage ? `${va.stage.emoji} S${va.stage.n}` : '—', vb.stage ? `${vb.stage.emoji} S${vb.stage.n}` : '—'),
    row('Weeks', `${va.stWord} ${va.st}`, `${vb.stWord} ${vb.st}`),
    row('Months+', `${va.ltWord} ${va.lt}`, `${vb.ltWord} ${vb.lt}`),
    RULE2, 'chart signals only · not advice'
  ].join('\n');
}

/* "mood" → the market gauge with a plain-English read */
export async function moodText() {
  const M = await sparkFetch(['SPY', '^VIX', 'TLT', 'HYG'], '1y', 8);
  const m = moodOf(M);
  if (!m) return '❓ Market data unavailable right now — try again in a minute.';
  const read = m.score < 25 ? 'Crowds are panicking — historically where the best long-term entries appeared.'
    : m.score < 45 ? 'Investors are nervous; prices lean cautious.'
    : m.score <= 55 ? 'No strong emotion either way — stock-picking matters more than timing.'
    : m.score < 75 ? 'Investors are optimistic and chasing — be picky with new entries.'
    : 'Crowds are euphoric — corrections often start from readings like this.';
  return [
    `🌡 MARKET MOOD`, RULE2,
    `${m.score}/100 — ${m.label}${m.vix != null ? ` · VIX ${m.vix}` : ''}`,
    read, '',
    `Gauge & components:`, `${SITE}#mood`
  ].join('\n');
}

/* "ideas" → the strongest charts you don't own, from the 30-name universe */
export async function ideasText(cfg) {
  const own = new Set(Object.keys((cfg && cfg.holdings) || {}));
  const syms = IDEAS.filter(s => !own.has(s));
  const I = await sparkFetch(syms, '1y', 8);
  const ranked = syms.map(s => I[s] && I[s].closes.length > 200 ? { s, v: verdicts(I[s].closes) } : null)
    .filter(Boolean).sort((a, b) => (b.v.lt * 2 + b.v.st) - (a.v.lt * 2 + a.v.st)).slice(0, 8);
  if (!ranked.length) return '❓ Idea data unavailable right now — try again in a minute.';
  return [
    `💡 IDEAS — strongest charts you don't own`, RULE2,
    ...ranked.map((x, i) => ` ${i + 1} ${x.s} — ${x.v.ltWord} ${x.v.lt}/100`),
    '', 'Chart score only — research the business before buying.',
    `Full 30-stock scanner:`, `${SITE}#ideas`
  ].join('\n');
}
