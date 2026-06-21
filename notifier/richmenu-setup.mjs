/* richmenu-setup.mjs — create the LINE rich menu, upload its image, set it as default.
   Gets a short-lived channel token from CHANNEL_ID + LINE_CHANNEL_SECRET (env). */
import { readFile } from 'node:fs/promises';

const CHANNEL_ID = '2010387622';
const SECRET = (process.env.LINE_CHANNEL_SECRET || '').trim();
const BASE = 'https://supakiat999.github.io/InvestmentReport/TrackingStocks.html';

const die = (m, x) => { console.error('FAIL:', m, x || ''); process.exit(1); };

/* 1) token via client_credentials */
let r = await fetch('https://api.line.me/v2/oauth/accessToken', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CHANNEL_ID, client_secret: SECRET })
});
let j = await r.json();
if (!j.access_token) die('token', JSON.stringify(j));
const tok = j.access_token;
const auth = { Authorization: `Bearer ${tok}` };
console.log('1) got channel token ✓');

/* (clean up any existing menus so re-runs don't pile up) */
r = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: auth });
j = await r.json();
for (const m of (j.richmenus || [])) {
  await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE', headers: auth });
}
if ((j.richmenus || []).length) console.log(`   removed ${j.richmenus.length} old menu(s)`);

/* 2) create the menu — 6 buttons, two rows of three (2500x1686).
   Row 1: Report Now (instant chat reply) · Live Tracker · Holdings
   Row 2: Market Mood · Stock Ideas · Portfolio
   "Report Now" is a message action: tapping posts a message the /line webhook
   replies to with a fresh digest (free, unlimited). The other five open the tracker. */
const menu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'Stock Report menu',
  chatBarText: 'Stock Report',
  areas: [
    { bounds: { x: 0,    y: 0,   width: 833, height: 843 }, action: { type: 'message', label: 'Report Now', text: '📊 Report now' } },
    { bounds: { x: 833,  y: 0,   width: 834, height: 843 }, action: { type: 'uri', label: 'Live Tracker', uri: BASE + '#live' } },
    { bounds: { x: 1667, y: 0,   width: 833, height: 843 }, action: { type: 'uri', label: 'Holdings',     uri: BASE + '#holdings' } },
    { bounds: { x: 0,    y: 843, width: 833, height: 843 }, action: { type: 'uri', label: 'Market Mood',  uri: BASE + '#mood' } },
    { bounds: { x: 833,  y: 843, width: 834, height: 843 }, action: { type: 'uri', label: 'Stock Ideas',  uri: BASE + '#ideas' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'uri', label: 'Portfolio',    uri: BASE + '#portfolio' } }
  ]
};
r = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(menu) });
j = await r.json();
if (!j.richMenuId) die('create', JSON.stringify(j));
const id = j.richMenuId;
console.log('2) created rich menu', id);

/* 3) upload the image */
const img = await readFile(new URL('./richmenu.png', import.meta.url));
r = await fetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: img });
if (!r.ok) die('upload', r.status + ' ' + await r.text());
console.log('3) uploaded image ✓ (' + img.length + ' bytes)');

/* 4) set as default for all users */
r = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${id}`, { method: 'POST', headers: auth });
if (!r.ok) die('setDefault', r.status + ' ' + await r.text());
console.log('4) set as default menu ✓');

/* 5) verify */
r = await fetch('https://api.line.me/v2/bot/user/all/richmenu', { headers: auth });
j = await r.json();
console.log('5) active default menu id:', j.richMenuId, j.richMenuId === id ? '✓ MATCH' : '✗');
