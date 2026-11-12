import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer, { type Browser } from 'puppeteer-core';

import { config } from '../config.js';
import { ContractService } from './ContractService.js';
import { AppError } from '../utils/AppError.js';

/**
 * The signed agreement as a PDF, rendered on the server.
 *
 * Urdu is the reason this goes through a browser. Its letters join and change
 * shape depending on their neighbours, and no Node PDF library does that
 * shaping properly — the output is a row of disconnected letters, which on a
 * document somebody signed is worse than no Urdu at all. Chromium shapes it
 * correctly, so the agreement is built as one self-contained HTML page and
 * headless Chromium prints it.
 *
 * Nothing is fetched while it renders. The Urdu font (Noto Nastaliq Urdu, from
 * an npm package) and the signature are embedded as data URIs, and a strict
 * Content-Security-Policy forbids scripts and any network request, so the
 * result does not depend on which fonts the server image happens to carry.
 *
 * Chromium is a system package, not an npm one: `server/Dockerfile` installs
 * it, and `PDF_CHROMIUM_PATH` points elsewhere when needed. Where it is
 * missing the endpoint answers 503 and says why, and printing from the browser
 * keeps working as before.
 */

export type RenderedContract = Awaited<ReturnType<typeof ContractService.render>>;

/** Turns the finished HTML page into PDF bytes. Replaceable, so tests need no browser. */
export type PdfRenderer = (html: string) => Promise<Buffer>;

const FONT_FILES = [
  'node_modules/@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2',
  'server/node_modules/@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2',
];

const CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium-browser', // Alpine, older Debian
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/pw-browsers/chromium', // a Playwright install, on a developer machine
];

const RENDER_TIMEOUT_MS = 30_000;

let urduFontDataUri: string | null | undefined;

/** The Urdu font as a data URI, read once. Null when the package is not installed. */
function urduFont(): string | null {
  if (urduFontDataUri !== undefined) return urduFontDataUri;
  urduFontDataUri = null;
  for (const relative of FONT_FILES) {
    const file = path.resolve(process.cwd(), relative);
    if (fs.existsSync(file)) {
      urduFontDataUri = `data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}`;
      break;
    }
  }
  return urduFontDataUri;
}

export function findChromium(): string | null {
  const configured = config.pdf.chromiumPath;
  if (configured) return fs.existsSync(configured) ? configured : null;
  return CHROMIUM_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/** Paragraph breaks in a clause are blank lines; each becomes its own `<p>`. */
const paragraphs = (text: string, attrs = '') =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p${attrs}>${escapeHtml(p.trim())}</p>`)
    .join('');

/** Pakistan time, written out, so the PDF reads the same wherever it is opened. */
function pkt(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' PKT'
  );
}

/**
 * The page Chromium prints. Exported so a test can read exactly what the
 * customer's copy says without needing a browser.
 */
export function contractHtml(document: RenderedContract): string {
  const { contract, snapshot, clauses, declaration } = document;
  const font = urduFont();

  // Only a PNG drawn on the signature pad is ever stored; anything else is
  // left out rather than placed in an `src`.
  const signature =
    contract.signatureImage && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(contract.signatureImage)
      ? `<img src="${contract.signatureImage}" alt="Customer signature">`
      : '';

  const status =
    contract.status === 'SIGNED'
      ? ''
      : contract.status === 'VOID'
        ? `<div class="notice">VOID — this agreement was cancelled${contract.voidReason ? `: ${escapeHtml(contract.voidReason)}` : '.'}<span dir="rtl" lang="ur"> یہ معاہدہ منسوخ ہو چکا ہے۔</span></div>`
        : `<div class="notice">DRAFT — not signed. This copy records no consent.<span dir="rtl" lang="ur"> مسودہ — اس پر دستخط نہیں ہوئے۔</span></div>`;

  // The same two warnings the dashboard shows. A copy that leaves the shop
  // must not look more reliable than the record it was printed from.
  const warnings = [
    document.hashMatches === false
      ? '<div class="notice">Warning: the stored record no longer matches its signature. This is not what the customer accepted.</div>'
      : '',
    document.hashMatches !== false && document.planMatches === false
      ? `<div class="notice">Warning: the plan has changed since this was signed (${escapeHtml(document.planChanges.join(', '))}). The figures below are the signed ones, not the ones now in force.</div>`
      : '',
  ].join('');

  const figures: [string, string, string][] = [
    ['Total price', 'کل قیمت', money(snapshot.plan.totalAmount)],
    ['Down payment', 'ایڈوانس', money(snapshot.plan.downPayment)],
    ['Financed', 'باقی رقم', money(snapshot.plan.financedAmount)],
    ['Installments', 'اقساط', `${snapshot.plan.totalInstallments} × ${money(snapshot.plan.monthlyInstallment)}`],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>Agreement ${escapeHtml(contract.id)}</title>
<style>
${font ? `@font-face { font-family: "Almas Urdu"; src: url("${font}") format("woff2"); font-weight: 400 700; }` : ''}
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font: 10.5px/1.5 "Liberation Sans", "DejaVu Sans", Arial, Helvetica, sans-serif; }
[lang="ur"] { font-family: "Almas Urdu", "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Noto Sans Arabic", serif; font-size: 11px; line-height: 2.3; }
h1 { font-size: 16px; margin: 0; }
h2 { font-size: 11px; margin: 0 0 3px; }
h3 { font-size: 11px; margin: 0; }
p { margin: 0 0 5px; }
header { text-align: center; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 10px; }
header .meta { color: #444; font-size: 9.5px; }
.notice { border: 1.5px solid #000; padding: 6px 8px; margin: 0 0 10px; font-weight: bold; }
.two { display: flex; gap: 16px; margin-bottom: 10px; }
.two > div { flex: 1; }
.figures { display: flex; gap: 10px; border-top: 1px solid #999; border-bottom: 1px solid #999; padding: 8px 0; margin-bottom: 12px; }
.figures > div { flex: 1; }
.figures .label { font-size: 8.5px; text-transform: uppercase; color: #444; }
.figures .value { font-weight: bold; font-size: 11.5px; }
.clause { margin-bottom: 12px; }
.clause .heads { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; break-after: avoid; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 3px 0; border-bottom: 1px solid #ccc; }
th:last-child, td:last-child { text-align: right; }
.schedule { break-before: page; }
.sign { border-top: 1px solid #999; margin-top: 14px; padding-top: 10px; break-inside: avoid; }
.sign .boxes { display: flex; gap: 24px; margin-top: 12px; }
.sign .boxes > div { flex: 1; }
.sign .line { height: 76px; border-bottom: 1px solid #000; display: flex; align-items: flex-end; }
.sign .line img { max-height: 74px; max-width: 100%; }
.small { font-size: 9px; color: #333; }
.hash { font-size: 8.5px; color: #333; margin-top: 10px; word-break: break-all; }
</style>
</head>
<body>
<header>
  <h1>Installment Financing Agreement</h1>
  <div dir="rtl" lang="ur">اقساط پر خریداری کا معاہدہ</div>
  <div class="meta">${escapeHtml(snapshot.dealer.name)} · ${escapeHtml(snapshot.dealer.city)} · ${escapeHtml(snapshot.dealer.phone)}</div>
  <div class="meta">Agreement ${escapeHtml(contract.id)} · terms v${escapeHtml(contract.termsVersion)}</div>
</header>
${status}${warnings}
<section class="two">
  <div>
    <h2>Customer / <span lang="ur">گاہک</span></h2>
    <p>${escapeHtml(snapshot.customer.name)}<br>CNIC ${escapeHtml(snapshot.customer.cnic)}<br>${escapeHtml(snapshot.customer.phone)}<br>${escapeHtml(snapshot.customer.address)}</p>
  </div>
  <div>
    <h2>Handset / <span lang="ur">موبائل</span></h2>
    <p>${escapeHtml(snapshot.device.brand)} ${escapeHtml(snapshot.device.model)}<br>IMEI ${escapeHtml(snapshot.device.imei)}${snapshot.device.color ? `<br>${escapeHtml(snapshot.device.color)}` : ''}${snapshot.device.ramStorage ? `<br>${escapeHtml(snapshot.device.ramStorage)}` : ''}</p>
  </div>
</section>
<section class="figures">
${figures
  .map(
    ([label, labelUr, value]) =>
      `  <div><div class="label">${label} / <span lang="ur">${labelUr}</span></div><div class="value">${escapeHtml(value)}</div></div>`
  )
  .join('\n')}
</section>
<section>
${clauses
  .map(
    (clause) => `  <div class="clause">
    <div class="heads"><h3>${escapeHtml(clause.heading)}</h3><h3 dir="rtl" lang="ur">${escapeHtml(clause.headingUr)}</h3></div>
    ${paragraphs(clause.body)}
    ${paragraphs(clause.bodyUr, ' dir="rtl" lang="ur"')}
  </div>`
  )
  .join('\n')}
</section>
<section class="schedule">
  <h3>Repayment schedule / <span lang="ur">اقساط کا شیڈول</span></h3>
  <table>
    <thead><tr><th>#</th><th>Due date / <span lang="ur">تاریخ</span></th><th>Amount / <span lang="ur">رقم</span></th></tr></thead>
    <tbody>
${snapshot.schedule
  .map(
    (row) =>
      `      <tr><td>${escapeHtml(row.installmentNumber)}</td><td>${escapeHtml(row.dueDate)}</td><td>${escapeHtml(money(row.amountDue))}</td></tr>`
  )
  .join('\n')}
    </tbody>
  </table>
</section>
<section class="sign">
  <p>${escapeHtml(declaration.en)}</p>
  <p dir="rtl" lang="ur">${escapeHtml(declaration.ur)}</p>
  <div class="boxes">
    <div>
      <div class="line">${signature}</div>
      <div class="small">Customer / <span lang="ur">گاہک</span>${contract.signerName ? ` — ${escapeHtml(contract.signerName)}` : ''}</div>
      ${contract.signedAt ? `<div class="small">Signed ${escapeHtml(pkt(contract.signedAt))}</div>` : ''}
    </div>
    <div>
      <div class="line"></div>
      <div class="small">For ${escapeHtml(snapshot.dealer.name)} / <span lang="ur">دکان کی جانب سے</span></div>
    </div>
  </div>
  <div class="hash">
    Terms version ${escapeHtml(contract.termsVersion)}${contract.documentHash ? ` · Document hash (SHA-256): ${escapeHtml(contract.documentHash)}` : ' · Not signed: no document hash'}
  </div>
</section>
</body>
</html>`;
}

/**
 * Prints the page with the system's Chromium, driven over the DevTools
 * protocol by `puppeteer-core` (which, unlike `puppeteer`, downloads no
 * browser of its own). One browser per document, closed when it is done.
 *
 * Chromium's own `--print-to-pdf` switch would have avoided the dependency,
 * but it does not reliably exit on current builds, and a request that hangs
 * for thirty seconds is not a download button.
 */
async function renderWithChromium(html: string): Promise<Buffer> {
  const chromium = findChromium();
  if (!chromium) {
    throw new AppError(
      'PDF download is not set up on this server: Chromium is not installed. Use Print / Save as PDF instead.',
      503,
      { code: 'PDF_UNAVAILABLE' }
    );
  }

  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'almas-contract-'));
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      userDataDir: profile,
      timeout: RENDER_TIMEOUT_MS,
      args: [
        // The container runs as an unprivileged user with no user namespaces,
        // where Chromium's own sandbox cannot start. The only page it ever
        // loads is one this server wrote, with scripts off and the network
        // forbidden by its CSP.
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    return Buffer.from(pdf);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[contract-pdf] Chromium could not render the agreement:', err);
    throw new AppError('The PDF could not be prepared on this server. Use Print / Save as PDF instead.', 503, {
      code: 'PDF_FAILED',
    });
  } finally {
    await browser?.close().catch(() => undefined);
    await fs.promises.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

let renderer: PdfRenderer = renderWithChromium;

/**
 * One browser at a time. Each render is a few hundred megabytes for a couple
 * of seconds, and the VPS this runs on is small; a queue is slower for the
 * second person and safer for everybody.
 */
let queue: Promise<unknown> = Promise.resolve();

export class ContractPdfService {
  static async render(contractId: string): Promise<{ pdf: Buffer; filename: string }> {
    const document = await ContractService.render(contractId);
    const html = contractHtml(document);

    const job = queue.then(() => renderer(html));
    queue = job.catch(() => undefined);
    const pdf = await job;

    const safeId = document.contract.id.replace(/[^A-Za-z0-9_-]/g, '');
    return { pdf, filename: `agreement-${safeId}.pdf` };
  }

  /** For tests: swap the browser for a stub, and put it back with no argument. */
  static setRenderer(replacement?: PdfRenderer): void {
    renderer = replacement ?? renderWithChromium;
  }
}
