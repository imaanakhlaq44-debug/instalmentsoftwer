#!/usr/bin/env node
/**
 * Render the DPC lock screen as a still the guide video can cut to.
 *
 * A locked handset cannot be screenshotted from the dashboard, and the mockup
 * the first ad used is gone, so the screen is rebuilt here from the app's own
 * source: every line of Urdu is copied from android/dpc/.../values-ur/strings.xml
 * and every colour from values/colors.xml. Change the app and this still is
 * wrong, so it is rendered from those files rather than drawn by hand.
 *
 *   node scripts/video/lockscreen.mjs [outFile]
 *
 * The figures are the same demo sale the rest of the stills show: Al-Madina
 * Mobile Hub, 6 × Rs. 7,750. No real customer's data appears anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const OUT = process.argv[2] || 'E:/Almas/almas_app/installment softwer/videos/stills/22-lock-screen.png';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RES = 'android/dpc/src/main/res';

/** Read one <string name="..."> out of the app's own resources. */
const strings = fs.readFileSync(path.join(RES, 'values-ur/strings.xml'), 'utf8');
const str = (name) => {
  const m = strings.match(new RegExp('<string name="' + name + '">([\\s\\S]*?)</string>'));
  if (!m) throw new Error('string not found: ' + name);
  return m[1].trim();
};

/** Read one <color name="..."> out of the app's own resources. */
const colors = fs.readFileSync(path.join(RES, 'values/colors.xml'), 'utf8');
const color = (name) => {
  const m = colors.match(new RegExp('<color name="' + name + '">(#[0-9A-Fa-f]{6,8})</color>'));
  if (!m) throw new Error('color not found: ' + name);
  return m[1];
};

/** The demo sale the stills were captured from. */
const DEMO = {
  amount: '7,750',
  due: '10 نومبر 2026',
  shop: 'Al-Madina Mobile Hub',
  methods: 'Cash, JazzCash, Easypaisa',
};

const html = `
<style>
  :root {
    --cream:#FFF8E8;
    --lock-bg:${color('lock_background')};
    --lock-panel:${color('lock_panel')};
    --on-lock:${color('on_lock')};
    --on-lock-muted:${color('on_lock_muted')};
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1920px; height:1080px; background:var(--cream);
         display:grid; place-items:center; overflow:hidden;
         font-family:'Noto Naskh Arabic','Segoe UI',system-ui,sans-serif; }

  /* The handset: 9:19.5, the shape of the phones these shops actually finance. */
  .phone { width:470px; height:1018px; background:#0B0B0D; border-radius:54px;
           padding:12px; box-shadow:0 40px 90px rgba(15,20,25,.28); }
  .screen { width:100%; height:100%; border-radius:44px; background:var(--lock-bg);
            color:var(--on-lock); padding:26px 22px; display:flex; flex-direction:column;
            gap:18px; direction:rtl; text-align:center; overflow:hidden; position:relative; }

  .status { display:flex; justify-content:space-between; align-items:center;
            font-size:13px; color:var(--on-lock-muted); direction:ltr; padding:0 6px; }
  .notch { position:absolute; top:18px; left:50%; transform:translateX(-50%);
           width:14px; height:14px; border-radius:50%; background:#000; }

  .icon { width:62px; height:62px; margin:14px auto 0; border-radius:50%;
          background:rgba(255,255,255,.14); display:grid; place-items:center; }
  .icon svg { width:30px; height:30px; fill:none; stroke:var(--on-lock); stroke-width:2; }

  .heading { font-size:24px; font-weight:700; line-height:1.7; }
  .message { font-size:16px; line-height:1.9; color:var(--on-lock-muted); padding:0 6px; }

  .panel { background:var(--lock-panel); border-radius:18px; padding:20px;
           display:grid; gap:14px; text-align:right; }
  .row { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .label { font-size:13px; color:var(--on-lock-muted); }
  .amount { font-size:32px; font-weight:700; direction:rtl; }
  .value { font-size:18px; font-weight:600; }
  .methods { font-size:14px; color:var(--on-lock-muted); }

  .buttons { margin-top:auto; display:grid; gap:12px; }
  .btn { border-radius:14px; padding:15px; font-size:16px; font-weight:600; }
  .btn.solid { background:#fff; color:${color('lock_background')}; }
  .btn.ghost { border:1.5px solid rgba(255,255,255,.45); color:var(--on-lock); }
</style>

<div class="phone"><div class="screen">
  <div class="notch"></div>
  <div class="status"><span>10:42</span><span>5G ▲ 🔋 82%</span></div>

  <div class="icon">
    <svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
  </div>

  <div class="heading">${str('lock_heading')}</div>
  <div class="message">${str('lock_default_message')}</div>

  <div class="panel">
    <div class="row"><span class="amount">${DEMO.amount} روپے</span><span class="label">${str('lock_amount_label')}</span></div>
    <div class="row"><span class="value">${DEMO.due}</span><span class="label">${str('lock_due_label')}</span></div>
    <div class="row"><span class="value">${DEMO.shop}</span><span class="label">${str('lock_pay_at')}</span></div>
    <div class="methods">${str('lock_methods').replace('%1$s', DEMO.methods)}</div>
  </div>

  <div class="buttons">
    <div class="btn solid">${str('lock_call_shop')}</div>
    <div class="btn ghost">${str('lock_emergency')}</div>
    <div class="btn ghost">${str('lock_refresh')}</div>
  </div>
</div></div>
`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT });
await browser.close();
console.log(OUT);
