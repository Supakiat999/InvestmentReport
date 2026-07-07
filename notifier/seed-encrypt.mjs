/* seed-encrypt.mjs — encrypt the private portfolio-seed.js into holdings.enc.json,
   which IS safe to publish: AES-256-GCM, key derived from a passcode via PBKDF2.
   Run:  node seed-encrypt.mjs            (prompts for the passcode)
         node seed-encrypt.mjs --pass X   (passcode on the command line — avoid in shared shells)
   The tracker's 🔐 unlock button fetches holdings.enc.json and decrypts in the browser. */
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const ITER = 310000;

async function getPass() {
  const i = process.argv.indexOf('--pass');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const p = await rl.question('Passcode to encrypt with: ');
  rl.close();
  return p.trim();
}

/* load the seed by evaluating portfolio-seed.js with a stub window */
const src = await readFile(new URL('../portfolio-seed.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
if (!window.MY_PORTFOLIO_SEED) { console.error('FAIL: portfolio-seed.js did not set window.MY_PORTFOLIO_SEED'); process.exit(1); }
const plain = new TextEncoder().encode(JSON.stringify(window.MY_PORTFOLIO_SEED));

const pass = await getPass();
if (!pass) { console.error('FAIL: empty passcode'); process.exit(1); }

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

const b64 = u8 => Buffer.from(u8).toString('base64');
const out = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
await writeFile(new URL('../holdings.enc.json', import.meta.url), JSON.stringify(out));
console.log('wrote holdings.enc.json —', ct.length, 'bytes ciphertext. Decrypts only with the passcode.');
