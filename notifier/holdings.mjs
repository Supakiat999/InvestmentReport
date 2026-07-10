/* holdings.mjs — chat-trade bookkeeping for the LINE bot.
   Pure functions only (no I/O): the worker supplies the merged holdings and persists the
   overlay to KV. This edits the bot's RECORDS of what you own — it never places real orders.

   Grammar (case-insensitive):
     buy NVDA 5           add 5 shares (avg cost unchanged / 0 for a new symbol)
     buy NVDA 5 @180.5    add 5 shares at 180.5 → weighted-average cost
     add PTT.BK 100 45    "add" = buy; "@"/"at" before the price is optional
     sell NVDA 2          reduce by 2 shares
     reduce NVDA 2        "reduce" = sell
     sell NVDA all        close the position entirely                                   */

const num = s => parseFloat(String(s).replace(/,/g, ''));
const fmtQ = n => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fmtC = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/* returns {action:'buy'|'sell', sym, qty:number|'all', price:number|null} or null if not a trade */
export function parseTrade(text) {
  const m = String(text || '').trim().match(
    /^(buy|add|sell|reduce)\s+([A-Za-z0-9.\-^=]{1,14})\s+(all|[\d,]+(?:\.\d+)?)\s*(?:@|at\s)?\s*([\d,]+(?:\.\d+)?)?\s*$/i);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  return {
    action: (verb === 'buy' || verb === 'add') ? 'buy' : 'sell',
    sym: m[2].toUpperCase(),
    qty: m[3].toLowerCase() === 'all' ? 'all' : num(m[3]),
    price: m[4] != null ? num(m[4]) : null
  };
}

/* applies a trade against the current merged holdings.
   returns { entry, summary } on success (entry === null means "position closed / delete"),
   or { error } with a human message. Never mutates its inputs. */
export function applyTrade(holdings, tr) {
  const cur = holdings[tr.sym];
  if (tr.action === 'buy') {
    if (tr.qty === 'all' || !(tr.qty > 0))
      return { error: `Tell me how many shares, e.g. "buy ${tr.sym} 5" or "buy ${tr.sym} 5 @180".` };
    if (tr.price != null && !(tr.price > 0))
      return { error: `That price doesn't look right — e.g. "buy ${tr.sym} ${fmtQ(tr.qty)} @180.50".` };
    const oldSh = cur ? cur.shares : 0, oldCost = (cur && cur.cost) || 0;
    const newSh = +(oldSh + tr.qty).toFixed(6);
    const newCost = tr.price != null
      ? +(((oldSh * oldCost) + (tr.qty * tr.price)) / newSh).toFixed(6)
      : oldCost;
    const entry = {
      shares: newSh, cost: newCost,
      currency: cur ? cur.currency : (tr.sym.endsWith('.BK') ? 'THB' : 'USD'),
      group: (cur && cur.group) || ''
    };
    const lines = [`✅ ${tr.sym}: ${fmtQ(oldSh)} → ${fmtQ(newSh)} sh`];
    if (tr.price != null && oldSh > 0 && oldCost > 0) lines.push(`avg cost ${fmtC(oldCost)} → ${fmtC(newCost)}`);
    else if (tr.price != null) lines.push(`avg cost ${fmtC(newCost)}`);
    else if (!cur) lines.push(`(no price given — "buy ${tr.sym} ${fmtQ(tr.qty)} @price" also tracks your P/L)`);
    return { entry, summary: lines.join('\n') };
  }
  /* sell / reduce */
  if (!cur || !(cur.shares > 0))
    return { error: `You don't hold ${tr.sym} in this bot's records — send "holdings" to see the list.` };
  const q = tr.qty === 'all' ? cur.shares : tr.qty;
  if (!(q > 0)) return { error: `Tell me how many shares, e.g. "sell ${tr.sym} 2" or "sell ${tr.sym} all".` };
  if (q > cur.shares + 1e-9)
    return { error: `You only hold ${fmtQ(cur.shares)} ${tr.sym} — can't sell ${fmtQ(q)}. ("sell ${tr.sym} all" closes it.)` };
  const left = +(cur.shares - q).toFixed(6);
  if (left <= 1e-9)
    return { entry: null, summary: `✅ ${tr.sym}: sold all ${fmtQ(cur.shares)} sh — position closed.` };
  return { entry: { ...cur, shares: left }, summary: `✅ ${tr.sym}: ${fmtQ(cur.shares)} → ${fmtQ(left)} sh` };
}

/* "holdings" command — compact list of the merged records */
export function holdingsListText(holdings, updatedIso) {
  const syms = Object.keys(holdings).filter(s => holdings[s] && holdings[s].shares > 0).sort();
  if (!syms.length) return '💼 No holdings recorded yet — "buy SYM QTY @PRICE" adds one.';
  return [
    `💼 HOLDINGS (${syms.length})`, '━━━━━━━━━━━━━',
    ...syms.map(s => {
      const h = holdings[s];
      return ` • ${s} ${fmtQ(h.shares)} sh${h.cost > 0 ? ` @ ${fmtC(h.cost)}` : ''}`;
    }),
    ...(updatedIso ? ['', `last chat edit: ${updatedIso.slice(0, 16).replace('T', ' ')} UTC`] : [])
  ].join('\n');
}
