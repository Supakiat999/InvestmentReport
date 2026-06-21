/* icon-gen.mjs — draws the Stock Report PWA icons (icon-192.png, icon-512.png in repo root).
   Run: node icon-gen.mjs */
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';

const BG = '#0E1B1E', GOLD = '#E8B44C', GREEN = '#4FCB8B', BLUE = '#7FB8C9';

function draw(S) {
  const cv = createCanvas(S, S);
  const c = cv.getContext('2d');
  /* rounded dark background */
  const r = S * 0.20;
  c.fillStyle = BG;
  c.beginPath();
  c.moveTo(r, 0); c.arcTo(S, 0, S, S, r); c.arcTo(S, S, 0, S, r); c.arcTo(0, S, 0, 0, r); c.arcTo(0, 0, S, 0, r);
  c.closePath(); c.fill();
  /* ascending bar chart */
  const x0 = S * 0.22, bw = S * 0.13, gap = S * 0.055, base = S * 0.73;
  const hs = [0.24, 0.40, 0.32, 0.52], cols = [GREEN, GOLD, BLUE, GREEN];
  hs.forEach((h, i) => { c.fillStyle = cols[i]; const x = x0 + i * (bw + gap); const bh = S * h; c.fillRect(x, base - bh, bw, bh); });
  /* gold baseline */
  c.fillStyle = GOLD; c.fillRect(S * 0.18, base, S * 0.64, S * 0.035);
  return cv;
}

for (const S of [192, 512]) {
  const png = await draw(S).encode('png');
  await writeFile(new URL(`../icon-${S}.png`, import.meta.url), png);
  console.log(`wrote icon-${S}.png`, png.length, 'bytes');
}
