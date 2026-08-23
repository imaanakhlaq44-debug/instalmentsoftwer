import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Derives the app's logo assets from the artwork in `brand/`.
 *
 * The artwork arrives as a pair of 2816×1536 JPEGs weighing about 1.2 MB each,
 * on a white background. Shipped as they are they would be three separate
 * problems: a megabyte of logo on a 3G connection, a white rectangle sitting on
 * the app's warm paper canvas, and a `.jfif` extension some servers refuse to
 * type correctly.
 *
 * So the originals stay in `brand/` as the source of truth, and this script
 * produces what the browser actually loads:
 *
 *   - the mark, trimmed and keyed to transparency, at two sizes
 *   - the full lockup, same treatment, for the login screen and the site header
 *   - a favicon
 *
 * Run it again whenever the artwork changes: `npm --prefix site run brand`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = path.join(ROOT, 'brand');
const TARGETS = [path.join(ROOT, 'site', 'public'), path.join(ROOT, 'client', 'public')];

/**
 * Turns the white studio background transparent.
 *
 * Not by keying every white pixel — that was the first attempt and it was
 * wrong twice over. The artwork is a JPEG, so its "white" is really 240–255
 * with compression noise, which left a milky haze across the whole image; and
 * the diamond's facets are separated by white lines that are *part of the
 * drawing*, which a global key punches holes through.
 *
 * So the background is found the way a person would see it: flood-fill inwards
 * from the edges of the canvas. Only whiteness connected to the outside is
 * background. Everything enclosed by the mark stays exactly as drawn.
 */
async function keyOutWhite(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  /** Generous, because JPEG noise pushes a flat white down into the 230s. */
  const BACKGROUND = 228;

  const isPale = (px) => {
    const i = px * channels;
    return Math.min(data[i], data[i + 1], data[i + 2]) >= BACKGROUND;
  };

  const outside = new Uint8Array(width * height);
  const stack = [];

  for (let x = 0; x < width; x += 1) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(y * width, y * width + width - 1);
  }

  while (stack.length) {
    const px = stack.pop();
    if (outside[px] || !isPale(px)) continue;
    outside[px] = 1;

    const x = px % width;
    const y = (px - x) / width;
    if (x > 0) stack.push(px - 1);
    if (x < width - 1) stack.push(px + 1);
    if (y > 0) stack.push(px - width);
    if (y < height - 1) stack.push(px + width);
  }

  for (let px = 0; px < width * height; px += 1) {
    if (!outside[px]) continue;
    data[px * channels + 3] = 0;
  }

  /**
   * One feathering pass along the new edge.
   *
   * A pixel that survived but touches the background is on the anti-aliased
   * boundary, and is part white. Its alpha is reduced by how pale it is, which
   * is what keeps the mark from wearing a bright fringe once it sits on the
   * app's warm paper rather than on white.
   */
  const FRINGE = 200;
  for (let px = 0; px < width * height; px += 1) {
    if (outside[px] || data[px * channels + 3] === 0) continue;

    const x = px % width;
    const y = (px - x) / width;
    const touchesBackground =
      (x > 0 && outside[px - 1]) ||
      (x < width - 1 && outside[px + 1]) ||
      (y > 0 && outside[px - width]) ||
      (y < height - 1 && outside[px + width]);
    if (!touchesBackground) continue;

    const i = px * channels;
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (min > FRINGE) {
      data[i + 3] = Math.round(255 * (1 - (min - FRINGE) / (BACKGROUND - FRINGE)));
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png();
}

/** Crops the transparent margin the artwork was exported with. */
const trimmed = (img) => img.trim({ threshold: 1 });

async function emit(name, buffer) {
  for (const dir of TARGETS) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), buffer);
  }
  process.stdout.write(`  ${name.padEnd(24)} ${(buffer.length / 1024).toFixed(1)} kB\n`);
}

const mark = await keyOutWhite(path.join(BRAND, 'almas-sdm-mark.jpg'));
const lockup = await keyOutWhite(path.join(BRAND, 'almas-sdm-lockup.jpg'));

/**
 * Each asset ships as WebP and PNG.
 *
 * WebP is what the browser actually loads — a third of the size at the same
 * quality, and every Android phone this product runs on has supported it for
 * years. The PNG is the fallback the `<picture>` element names, and it is
 * palette-quantised: this is flat vector artwork, so 256 colours costs nothing
 * visible and saves about four fifths of the file.
 */
async function emitPair(base, image, width) {
  const sized = trimmed(image.clone()).resize({ width, fit: 'inside' });
  await emit(`${base}.webp`, await sized.clone().webp({ quality: 90, effort: 6 }).toBuffer());
  await emit(
    `${base}.png`,
    await sized.clone().png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer()
  );
}

// The mark, for the header badge and anywhere the name is already set beside it.
await emitPair('logo-mark', mark, 256);

// The full lockup, for the login screen and the site's own hero.
await emitPair('logo-lockup', lockup, 720);

// Browser tab and the Android home screen.
await emit(
  'favicon.png',
  await trimmed(mark.clone())
    .resize({ width: 180, height: 180, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer()
);

process.stdout.write('Brand assets written to site/public and client/public\n');
