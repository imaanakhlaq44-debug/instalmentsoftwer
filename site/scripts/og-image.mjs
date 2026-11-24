import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The social preview card: public/og-image.png, 1200×630.
 *
 * WhatsApp, Facebook, LinkedIn and X all show a large card when a page offers
 * a 1200×630 image, and a small square thumbnail otherwise. The logo lockup is
 * 720×629, so on its own it only ever earned the small one.
 *
 * The PNG is committed, not built in CI: text in the SVG is drawn with the
 * machine's fonts, and the deploy runner should not decide what the card looks
 * like. Run again after changing the wording or the logo:
 *
 *   node scripts/og-image.mjs
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'og-image.png');

const W = 1200;
const H = 630;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="11" cy="11" r="1.2" fill="rgba(15,20,25,.09)"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="#FFF8E8"/>
  <rect width="100%" height="100%" fill="url(#dots)"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="28" fill="none" stroke="#0F1419" stroke-width="5"/>

  <g font-family="Archivo, 'Segoe UI', Arial, sans-serif" fill="#0F1419">
    <rect x="80" y="86" width="372" height="46" rx="23" fill="#fff" stroke="#0F1419" stroke-width="3"/>
    <circle cx="106" cy="109" r="7" fill="#1DB98F"/>
    <text x="124" y="117" font-size="21" font-weight="800" letter-spacing="2.5">MOBILE QIST SOFTWARE</text>

    <text x="80" y="226" font-size="74" font-weight="900" letter-spacing="-2">Phone locks.</text>
    <text x="80" y="310" font-size="74" font-weight="900" letter-spacing="-2" fill="#12305F">Paid? Phone opens.</text>

    <text x="80" y="384" font-size="29" font-weight="600" fill="#3A4350">Installment khata, SMS reminders from your SIM</text>
    <text x="80" y="424" font-size="29" font-weight="600" fill="#3A4350">and automatic lock and unlock for mobile shops.</text>

    <rect x="80" y="470" width="356" height="70" rx="16" fill="#FFC83D" stroke="#0F1419" stroke-width="3"/>
    <text x="104" y="515" font-size="30" font-weight="900">From Rs 500 / phone</text>
    <text x="462" y="515" font-size="26" font-weight="700" fill="#3A4350">No monthly fee · almassdm.pro</text>
  </g>
</svg>`;

const logo = await sharp(path.join(ROOT, 'public', 'logo-mark.png'))
  .resize({ width: 250, height: 250, fit: 'inside' })
  .toBuffer();
const meta = await sharp(logo).metadata();

await sharp(Buffer.from(svg))
  .composite([{ input: logo, left: W - 80 - meta.width, top: 86 }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(OUT);

process.stdout.write(`Wrote ${path.relative(process.cwd(), OUT)} (${W}×${H})\n`);
