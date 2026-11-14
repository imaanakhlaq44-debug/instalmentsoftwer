#!/usr/bin/env node
/**
 * Render the title cards the guide video cuts between dashboard stills.
 *
 * Same palette as the website, so a shopkeeper who saw the site recognises the
 * video: cream paper, navy ink, one sun-yellow accent. Urdu is set in Nastaliq;
 * the layer cards carry the English technical word, because that is the word a
 * mobile counter actually uses.
 *
 *   node scripts/video/slides.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const OUT = process.argv[2] || 'E:/Almas/almas_app/installment softwer/videos/slides';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Inlined: a page built with setContent has an about:blank origin, and Chrome
// refuses to load a file:// image into it however the path is spelled.
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('site/public/logo-lockup.png')).toString('base64');

const SLIDES = [
  { name: '00-intro', kind: 'brand', ur: 'فون قسطوں پر بیچیں، بے فکر ہو کر', en: 'Installment phones, fully under your control' },
  { name: '10-problem', kind: 'statement', ur: 'دو قسطیں آئیں، تیسری پر بندہ غائب', en: '' },
  { name: '30-imei-question', kind: 'question', ur: '؟IMEI چینج کرا لیا تو', en: '' },
  { name: '31-layer-1', kind: 'layer', n: '1', word: 'Enrolment', ur: 'لاک ایک ہی IMEI پر — میل نہ کھائے تو اندراج ہی نہیں' },
  { name: '32-layer-2', kind: 'layer', n: '2', word: 'Check-in', ur: 'ہر پندرہ منٹ بعد دوبارہ جانچ — بدلا تو خود بخود لاک' },
  { name: '33-layer-3', kind: 'layer', n: '3', word: 'Secure chip', ur: 'فون کا چپ خود گواہی دیتا ہے — ایپ پر بھروسہ نہیں' },
  { name: '34-layer-4', kind: 'layer', n: '4', word: 'Device owner + FRP', ur: 'ایپ ہٹانا اور ری سیٹ، دونوں بند' },
  { name: '35-layers-all', kind: 'statement', ur: 'چار layers — ایک ٹوٹے تو دوسری پکڑ لیتی ہے', en: 'Caught, not impossible' },
  { name: '99-outro', kind: 'brand', ur: 'پندرہ منٹ کا مفت ڈیمو', en: 'almassdm.pro' },
];

const css = `
  :root { --ink:#0F1419; --navy:#12305F; --sun:#FFC83D; --cream:#FFF8E8; --mint:#1DB98F; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1920px; height:1080px; background:var(--cream); color:var(--navy);
         font-family:Inter,system-ui,sans-serif; display:grid; place-items:center;
         text-align:center; overflow:hidden; }
  .ur { font-family:'Jameel Noori Nastaleeq','Noto Nastaliq Urdu',serif; direction:rtl; line-height:2.1; }
  .wrap { display:grid; gap:48px; justify-items:center; padding:0 160px; }
  img.logo { width:420px; }
  .brand .ur { font-size:58px; }
  .brand .en { font-size:30px; color:#3A4350; letter-spacing:.02em; }
  .statement .ur { font-size:76px; font-weight:700; }
  .statement .en { font-size:34px; color:var(--mint); font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .question .ur { font-size:112px; font-weight:700; }
  .question .rule { width:220px; height:10px; background:var(--sun); border-radius:6px; }
  .layer .n { font-size:200px; font-weight:900; color:var(--sun); line-height:.9;
              -webkit-text-stroke:5px var(--navy); }
  .layer .word { font-size:72px; font-weight:900; letter-spacing:-.02em; }
  .layer .ur { font-size:46px; color:#3A4350; }
`;

const body = (s) => {
  if (s.kind === 'brand')
    return `<div class="wrap brand"><img class="logo" src="${LOGO}"><div class="ur">${s.ur}</div><div class="en">${s.en}</div></div>`;
  if (s.kind === 'statement')
    return `<div class="wrap statement">${s.en ? `<div class="en">${s.en}</div>` : ''}<div class="ur">${s.ur}</div></div>`;
  if (s.kind === 'question')
    return `<div class="wrap question"><div class="ur">${s.ur}</div><div class="rule"></div></div>`;
  return `<div class="wrap layer"><div class="n">${s.n}</div><div class="word">${s.word}</div><div class="ur">${s.ur}</div></div>`;
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

for (const slide of SLIDES) {
  await page.setContent(`<style>${css}</style>${body(slide)}`, { waitUntil: 'load' });
  // Jameel Noori Nastaleeq is installed on this machine; wait for the face to
  // be ready so no screenshot lands on a fallback no Urdu reader would accept.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${slide.name}.png`) });
  console.log(slide.name);
}

await browser.close();
console.log(`\n${SLIDES.length} slides in ${OUT}`);
