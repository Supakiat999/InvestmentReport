/* richmenu-gen.mjs — draws the LINE rich menu image (2500x1686, 6 buttons, 2 rows × 3 cols). Run: node richmenu-gen.mjs */
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';

const W = 2500, H = 1686, COLS = 3, ROWS = 2, cw = W / COLS, ch = H / ROWS;
const BG = '#0E1B1E', SURF = '#152528', LINE = '#243B40', GOLD = '#E8B44C', GREEN = '#4FCB8B', RED = '#F07474', TEXT = '#E9EEEC', DIM = '#8FA6A3', BLUE = '#7FB8C9';

const cv = createCanvas(W, H);
const c = cv.getContext('2d');

/* background */
c.fillStyle = BG; c.fillRect(0, 0, W, H);
/* top accent bar */
c.fillStyle = GOLD; c.fillRect(0, 0, W, 8);

/* cell panels (subtle checkerboard so the 6 buttons read as a grid) */
for (let r = 0; r < ROWS; r++) {
  for (let i = 0; i < COLS; i++) {
    const top = r === 0 ? 8 : r * ch;
    c.fillStyle = (i + r) % 2 ? BG : SURF; c.globalAlpha = 0.5;
    c.fillRect(i * cw, top, cw, r * ch + ch - top); c.globalAlpha = 1;
  }
}
/* dividers: vertical between columns, horizontal between the two rows */
c.strokeStyle = LINE; c.lineWidth = 2;
for (let i = 1; i < COLS; i++) { c.beginPath(); c.moveTo(i * cw, 40); c.lineTo(i * cw, H - 40); c.stroke(); }
c.beginPath(); c.moveTo(40, ch); c.lineTo(W - 40, ch); c.stroke();

const cx = i => i * cw + cw / 2;   // column center x
const cyRow = r => r * ch;          // row top y
const ICON = 300, LABEL = 560, SUB = 640;   // offsets inside a row

function label(col, row, text, sub, color) {
  const x = cx(col), baseY = cyRow(row);
  c.textAlign = 'center';
  c.fillStyle = TEXT; c.font = 'bold 78px Arial, "Segoe UI", sans-serif';
  c.fillText(text, x, baseY + LABEL);
  c.fillStyle = color; c.font = '40px Arial, "Segoe UI", sans-serif';
  c.fillText(sub, x, baseY + SUB);
}

function roundRect(x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---- icon: REPORT NOW — chat bubble with text lines + a live dot ---- */
function iconReport(x, y) {
  const w = 184, h = 132, rx = x - w / 2, ry = y - h / 2 - 6, rad = 28;
  c.fillStyle = GOLD; roundRect(rx, ry, w, h, rad); c.fill();
  /* bubble tail */
  c.beginPath(); c.moveTo(rx + 42, ry + h - 4); c.lineTo(rx + 42, ry + h + 42); c.lineTo(rx + 90, ry + h - 4); c.closePath(); c.fill();
  /* text lines (dark, on the gold bubble) */
  c.fillStyle = BG;
  c.fillRect(rx + 26, ry + 34, w - 96, 15);
  c.fillRect(rx + 26, ry + 64, w - 52, 15);
  c.fillRect(rx + 26, ry + 94, w - 112, 15);
  /* live dot */
  c.fillStyle = GREEN; c.beginPath(); c.arc(rx + w - 32, ry + 40, 13, 0, Math.PI * 2); c.fill();
}

/* ---- icon: LIVE TRACKER — circular refresh arrows ---- */
function iconRefresh(x, y) {
  const r = 96;
  c.strokeStyle = GREEN; c.lineWidth = 22; c.lineCap = 'butt';
  c.beginPath(); c.arc(x, y, r, -Math.PI * 0.78, Math.PI * 0.30); c.stroke();
  c.beginPath(); c.arc(x, y, r, Math.PI * 0.22, Math.PI * 1.30); c.stroke();
  const head = (ang, dir) => {
    const hx = x + r * Math.cos(ang), hy = y + r * Math.sin(ang);
    const t = ang + dir * Math.PI / 2;
    c.fillStyle = GREEN; c.beginPath();
    c.moveTo(hx + 34 * Math.cos(t), hy + 34 * Math.sin(t));
    c.lineTo(hx - 26 * Math.cos(t + 0.5), hy - 26 * Math.sin(t + 0.5));
    c.lineTo(hx - 26 * Math.cos(t - 0.5), hy - 26 * Math.sin(t - 0.5));
    c.closePath(); c.fill();
  };
  head(Math.PI * 0.30, 1);
  head(Math.PI * 1.30, 1);
}

/* ---- icon: HOLDINGS — candlestick bars ---- */
function iconBars(x, y) {
  const baseY = y + 96;
  const bars = [{ dx: -90, h: 78, up: true }, { dx: -30, h: 138, up: true }, { dx: 30, h: 104, up: false }, { dx: 90, h: 162, up: true }];
  c.lineWidth = 8;
  for (const b of bars) {
    const col = b.up ? GREEN : RED, bx = x + b.dx;
    c.strokeStyle = col; c.beginPath(); c.moveTo(bx, baseY - b.h - 22); c.lineTo(bx, baseY + 14); c.stroke();   // wick
    c.fillStyle = col; c.fillRect(bx - 19, baseY - b.h, 38, b.h - 16);                                          // body
  }
}

/* ---- icon: MARKET MOOD — gauge arc + needle ---- */
function iconGauge(x, y) {
  const r = 110;
  c.lineWidth = 26; c.lineCap = 'round';
  const seg = [[GREEN, Math.PI, Math.PI * 1.33], [GOLD, Math.PI * 1.33, Math.PI * 1.66], [RED, Math.PI * 1.66, Math.PI * 2]];
  for (const [col, a0, a1] of seg) { c.strokeStyle = col; c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke(); }
  c.strokeStyle = TEXT; c.lineWidth = 10; c.beginPath(); c.moveTo(x, y); c.lineTo(x + r * 0.7 * Math.cos(-Math.PI * 0.25), y + r * 0.7 * Math.sin(-Math.PI * 0.25)); c.stroke();
  c.fillStyle = TEXT; c.beginPath(); c.arc(x, y, 16, 0, Math.PI * 2); c.fill();
}

/* ---- icon: STOCK IDEAS — lightbulb ---- */
function iconBulb(x, y) {
  c.fillStyle = GOLD; c.beginPath(); c.arc(x, y - 10, 80, 0, Math.PI * 2); c.fill();
  c.fillStyle = BG; c.beginPath(); c.arc(x, y - 10, 56, 0, Math.PI * 2); c.fill();
  c.strokeStyle = GOLD; c.lineWidth = 12; c.beginPath(); c.arc(x, y - 10, 68, 0, Math.PI * 2); c.stroke();
  c.fillStyle = GOLD; c.fillRect(x - 34, y + 70, 68, 22); c.fillRect(x - 26, y + 96, 52, 18);
  c.strokeStyle = GREEN; c.lineWidth = 10;
  c.beginPath(); c.moveTo(x - 26, y + 10); c.lineTo(x - 6, y - 18); c.lineTo(x + 8, y + 2); c.lineTo(x + 30, y - 30); c.stroke();
}

/* ---- icon: PORTFOLIO — allocation donut ---- */
function iconDonut(x, y) {
  const r = 92;
  c.lineWidth = 46; c.lineCap = 'butt';
  let a = -Math.PI / 2;
  for (const [col, f] of [[BLUE, 0.42], [GREEN, 0.28], [GOLD, 0.18], [RED, 0.12]]) {
    const a1 = a + f * Math.PI * 2;
    c.strokeStyle = col; c.beginPath(); c.arc(x, y, r, a, a1); c.stroke();
    a = a1;
  }
}

/* row 0 */
iconReport(cx(0), cyRow(0) + ICON); label(0, 0, 'REPORT NOW', 'tap = report in chat', GOLD);
iconRefresh(cx(1), cyRow(0) + ICON); label(1, 0, 'LIVE TRACKER', 'tap = refresh now', GREEN);
iconBars(cx(2), cyRow(0) + ICON); label(2, 0, 'HOLDINGS', 'what you own', GREEN);
/* row 1 */
iconGauge(cx(0), cyRow(1) + ICON); label(0, 1, 'MARKET MOOD', 'fear & greed gauge', GOLD);
iconBulb(cx(1), cyRow(1) + ICON); label(1, 1, 'STOCK IDEAS', "10 you don't own", GREEN);
iconDonut(cx(2), cyRow(1) + ICON); label(2, 1, 'PORTFOLIO', 'allocation & P/L', BLUE);

const png = await cv.encode('png');
await writeFile(new URL('./richmenu.png', import.meta.url), png);
console.log('wrote richmenu.png', png.length, 'bytes', W + 'x' + H);
