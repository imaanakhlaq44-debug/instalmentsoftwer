import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Real testimonials for the home page.
 *
 * The site is static, so the testimonials it prints are a file:
 * `src/data/testimonials.json`. The build reads that file and nothing else.
 * It holds only what the API's public endpoint returns — feedback a shop owner
 * wrote in the dashboard, consented to publish, and the platform approved —
 * and it is filled by this script, never by hand:
 *
 *   TESTIMONIALS_API_URL=https://api.example.pk npm run testimonials:pull
 *
 * An empty file (`[]`) is the honest default: the build then leaves the whole
 * section out, exactly as it does for the samples.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** TESTIMONIALS_FILE points a local preview or a test at another file. */
export const TESTIMONIALS_FILE = process.env.TESTIMONIALS_FILE
  ? path.resolve(process.env.TESTIMONIALS_FILE)
  : path.join(HERE, '..', 'src', 'data', 'testimonials.json');

const FIELDS = ['quote', 'displayName', 'city', 'rating', 'language'];

/**
 * Checks one list and returns it reduced to the five fields the site prints.
 * Throws on anything else: a malformed entry must stop a publish, not be
 * printed half-right under somebody's name.
 */
export function validateTestimonials(list, source = 'testimonials') {
  if (!Array.isArray(list)) throw new Error(`${source}: expected a list of testimonials.`);
  return list.map((t, i) => {
    const at = `${source}[${i}]`;
    if (!t || typeof t !== 'object') throw new Error(`${at}: not an object.`);
    for (const key of ['quote', 'displayName', 'city']) {
      if (typeof t[key] !== 'string' || !t[key].trim()) throw new Error(`${at}: "${key}" is missing.`);
    }
    if (!Number.isInteger(t.rating) || t.rating < 1 || t.rating > 5) throw new Error(`${at}: rating must be 1 to 5.`);
    if (t.language !== 'en' && t.language !== 'ur') throw new Error(`${at}: language must be "en" or "ur".`);
    return Object.fromEntries(FIELDS.map((key) => [key, typeof t[key] === 'string' ? t[key].trim() : t[key]]));
  });
}

export async function readTestimonials() {
  let raw;
  try {
    raw = await readFile(TESTIMONIALS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return validateTestimonials(JSON.parse(raw), path.basename(TESTIMONIALS_FILE));
}

/** `npm run testimonials:pull` */
async function pull() {
  const base = (process.env.TESTIMONIALS_API_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('Set TESTIMONIALS_API_URL to the API\'s address, e.g. TESTIMONIALS_API_URL=https://api.example.pk');
  }
  const url = `${base}/api/public/testimonials`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}.`);
  const list = validateTestimonials((await res.json()).testimonials, url);

  // Written only after the whole answer has been read and checked, so a failed
  // pull leaves the file — and therefore the site — exactly as it was.
  await writeFile(TESTIMONIALS_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
  process.stdout.write(`${list.length} approved testimonial(s) written to src/data/testimonials.json\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  pull().catch((err) => {
    console.error(`Testimonials not updated: ${err.message}`);
    process.exit(1);
  });
}
