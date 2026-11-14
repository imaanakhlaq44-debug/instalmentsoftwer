#!/usr/bin/env node
/**
 * Capture the dashboard stills the guide video is built from.
 *
 * 1920×1080, one PNG per shot, against the local demo database only. The first
 * video's stills were captured by hand and never saved with a recipe, so a
 * re-shoot meant starting over; this is that recipe.
 *
 *   npm run dev                      # API on 5000, dashboard on 5173
 *   node scripts/video/demo-state.mjs
 *   node scripts/video/shots.mjs [outDir]
 *
 * Chrome is taken from the system install: the Playwright chromium on this
 * machine is missing its VC++ runtime and will not start.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// puppeteer-core is a server dependency; resolve it from there rather than
// adding a second copy at the repository root.
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const WEB = process.env.WEB_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:5000/api';
const OUT = process.argv[2] || 'E:/Almas/almas_app/installment softwer/videos/stills';
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DEALER = { email: 'tariq@almadinamobiles.pk', password: 'ChangeMe#2026' };
const SUPER = { email: 'admin@almassdm.pk', password: 'ChangeMe#2026' };

/**
 * The shot list, in video order. `wait` is text that must appear before the
 * shutter: a screenshot of a spinner is worse than no screenshot.
 */
const SHOTS = [
  { name: '01-login', url: '/login', anon: true, wait: 'Sign in' },
  { name: '02-register', url: '/register', anon: true },
  { name: '03-dashboard', url: '/' },
  { name: '04-settings', url: '/settings' },
  { name: '05-settings-frp', url: '/settings', scrollTo: 'Factory Reset Protection' },
  { name: '06-licenses', url: '/licenses' },
  { name: '07-buy-locks', url: '/buy-locks' },
  { name: '08-customers', url: '/customers' },
  // The one-page sale is a modal on the customers page, not a route.
  { name: '09-sale-form', url: '/customers', click: 'Add Customer', wait: 'IMEI' },
  { name: '10-enrollment-qr', url: '/enrollment' },
  { name: '11-devices', url: '/devices' },
  { name: '12-device-tamper', url: '/devices/dev-6' },
  { name: '13-notifications', url: '/notifications' },
  { name: '14-installments', url: '/installments' },
  { name: '15-payments', url: '/payments' },
  { name: '16-transactions', url: '/transactions' },
  { name: '17-handset-tests', url: '/handset-tests' },
  { name: '18-audit-logs', url: '/audit-logs' },
  { name: '19-feedback', url: '/feedback' },
  { name: '20-platform-shops', url: '/shops', as: 'super' },
  { name: '21-platform-orders', url: '/orders', as: 'super' },
];

const login = async (who) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()).token;
};

const tokens = { dealer: await login(DEALER), super: await login(SUPER) };

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

// The token has to exist before the app boots, or the guard bounces to /login.
await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

let taken = 0;
const missing = [];

for (const shot of SHOTS) {
  const token = shot.anon ? null : tokens[shot.as === 'super' ? 'super' : 'dealer'];
  await page.evaluate(
    (t) => {
      if (t) localStorage.setItem('emi_auth_token', t);
      else localStorage.removeItem('emi_auth_token');
    },
    token,
  );

  await page.goto(WEB + shot.url, { waitUntil: 'networkidle2' });
  await settle(900);

  if (shot.click) {
    const clicked = await page.evaluate((label) => {
      const el = [...document.querySelectorAll('button, a')].find((n) =>
        n.textContent?.trim().toLowerCase().includes(label.toLowerCase()),
      );
      if (!el) return false;
      el.click();
      return true;
    }, shot.click);
    if (!clicked) missing.push(`${shot.name}: no control matching "${shot.click}"`);
    await settle(900);
  }

  if (shot.wait) {
    const found = await page
      .waitForFunction((t) => document.body.innerText.includes(t), { timeout: 8000 }, shot.wait)
      .then(() => true)
      .catch(() => false);
    if (!found) missing.push(`${shot.name}: never showed "${shot.wait}"`);
  }

  if (shot.scrollTo) {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('*')].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === t,
      );
      el?.scrollIntoView({ block: 'center' });
    }, shot.scrollTo);
    await settle(500);
  }

  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  const url = page.url().replace(WEB, '');
  if (!shot.anon && url.startsWith('/login')) missing.push(`${shot.name}: bounced to /login`);
  taken++;
  console.log(`${shot.name.padEnd(22)} ${url}`);
}

await browser.close();
console.log(`\n${taken} stills in ${OUT}`);
if (missing.length) {
  console.log('\nCheck these before cutting:');
  for (const m of missing) console.log(`  ${m}`);
}
