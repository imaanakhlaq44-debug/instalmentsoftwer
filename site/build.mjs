import { readFile, writeFile, mkdir, readdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);

/**
 * The site's build.
 *
 * Five pages of mostly-words do not need a framework, and the people this site
 * is for are on a phone on a 3G connection in a shop — so the output is plain
 * HTML with one stylesheet and about forty lines of JavaScript for the language
 * toggle. What a static-site generator would give us here is a layout that is
 * written once instead of five times, and that is all this script does.
 */

// fileURLToPath, not the URL's raw pathname: this project lives in a directory
// with a space in its name, which arrives percent-encoded otherwise.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');

/**
 * Where the "Sign in" button goes.
 *
 * The site is published before the dashboard has a server — it is the thing a
 * shop reads while deciding — so this cannot be baked in. In development it is
 * the Vite dev server; for the published build, pass the real one:
 *
 *   APP_URL=https://app.almassdm.pk npm run build
 *
 * Pointing it at a host that does not answer yet is worse than not linking at
 * all, so a build that leaves it unset keeps the localhost default and says so.
 * Until the dashboard is hosted anywhere, publish with `APP_URL=none` and the
 * button is left out of the page entirely — a shop reading this site should not
 * meet a dead link where the product is supposed to be.
 */
const APP_URL = (process.env.APP_URL || '').trim() || 'http://localhost:5173';
const HAS_APP = APP_URL !== 'none';

/**
 * The public address, for canonical links, social previews and structured
 * data. Search engines need absolute URLs in all three.
 */
const SITE_URL = (process.env.SITE_URL || 'https://almassdm.pro').replace(/\/+$/, '');

const escapeAttr = (s) =>
  String(s).replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const stripTags = (s) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Canonical, Open Graph and Twitter tags for one page. A shop owner shares a
 * link on WhatsApp far more often than anyone searches for it, and WhatsApp
 * builds its preview from exactly these tags.
 */
function seoTags({ file, title, description }) {
  const url = file === 'index.html' ? `${SITE_URL}/` : `${SITE_URL}/${file}`;
  const image = `${SITE_URL}/logo-lockup.png`;
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Almas SDM" />`,
    `<meta property="og:locale" content="en_PK" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="720" />`,
    `<meta property="og:image:height" content="629" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');
}

/**
 * FAQPage structured data, read from the page's own `<details>` blocks so the
 * markup can never claim an answer the visitor cannot see — Google ignores
 * (and can penalise) FAQ data that does not match the page.
 */
function faqJsonLd(html) {
  const items = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/details>/g)].map(
    ([, q, a]) => ({
      '@type': 'Question',
      name: stripTags(q),
      acceptedAnswer: { '@type': 'Answer', text: stripTags(a) },
    })
  );
  if (!items.length) return '';
  return jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items });
}

const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/** Who we are and what we sell, for the home page. */
function homeJsonLd() {
  return jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: 'Almas SDM',
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/logo-mark.png`,
        areaServed: 'PK',
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          telephone: '+447521606952',
          availableLanguage: ['en', 'ur'],
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: `${SITE_URL}/`,
        name: 'Almas SDM',
        inLanguage: ['en', 'ur'],
        publisher: { '@id': `${SITE_URL}/#org` },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Almas SDM',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Android, Web',
        description:
          'Mobile installment (qist) software for Pakistani phone shops: digital khata, SMS reminders from your own SIM, a signed Urdu/English agreement, and automatic phone lock and unlock.',
        publisher: { '@id': `${SITE_URL}/#org` },
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'PKR',
          lowPrice: 600,
          highPrice: 800,
          offerCount: 3,
          url: `${SITE_URL}/pricing.html`,
        },
      },
    ],
  });
}

/** Pulled out of each page's `<!-- meta ... -->` comment. */
function readMeta(html) {
  const match = html.match(/<!--\s*meta\s*([\s\S]*?)-->/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf(':');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  );
}

async function build() {
  const BUILD_VERSION = Date.now().toString(36);
  const rawLayout = await readFile(path.join(SRC, 'layout.html'), 'utf8');
  const withSignin = (html) =>
    HAS_APP
      ? html.replace(/<!--\s*\/?signin\s*-->/g, '')
      : html.replace(/<!--\s*signin\s*-->[\s\S]*?<!--\s*\/signin\s*-->/g, '');
  const layout = withSignin(rawLayout).replaceAll('/styles.css', `/styles.css?v=${BUILD_VERSION}`);
  const pages = (await readdir(path.join(SRC, 'pages'))).filter((f) => f.endsWith('.html'));

  await mkdir(OUT, { recursive: true });

  for (const file of pages) {
    const raw = await readFile(path.join(SRC, 'pages', file), 'utf8');
    const meta = readMeta(raw);
    const body = raw.replace(/<!--\s*meta[\s\S]*?-->/, '').trim();

    // A page with `layout: none` is a whole document of its own — the home
    // page, whose design does not share the inner pages' header and footer.
    // It still gets the Sign in rule and the app address.
    if (meta.layout === 'none') {
      const ownTitle = stripTags(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? meta.title ?? 'Almas SDM');
      const ownDesc = body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? meta.description ?? '';
      const seo = [
        seoTags({ file, title: ownTitle, description: ownDesc }),
        file === 'index.html' ? homeJsonLd() : '',
        faqJsonLd(body),
      ].filter(Boolean).join('\n    ');
      const out = withSignin(body).replaceAll('{{appUrl}}', APP_URL).replace('{{seo}}', seo);
      await writeFile(path.join(OUT, file), out, 'utf8');
      process.stdout.write(`  ${file} (own layout)\n`);
      continue;
    }

    const html = layout
      .replaceAll('{{title}}', meta.title ?? 'Almas SDM')
      .replaceAll('{{titleUr}}', meta.titleUr ?? meta.title ?? 'Almas SDM')
      .replaceAll('{{description}}', meta.description ?? '')
      .replaceAll('{{page}}', meta.page ?? '')
      .replaceAll('{{appUrl}}', APP_URL)
      .replace(
        '{{seo}}',
        [
          seoTags({ file, title: `${meta.title ?? 'Almas SDM'} · Almas SDM`, description: meta.description ?? '' }),
          faqJsonLd(body),
        ].filter(Boolean).join('\n    ')
      )
      .replace('{{content}}', body);

    await writeFile(path.join(OUT, file), html, 'utf8');
    process.stdout.write(`  ${file}\n`);
  }

  // Tailwind, once, over the built HTML.
  //
  // Invoked as `node <cli.js>` rather than through the `.bin` shim: on Windows
  // the shim is a .cmd file, and spawning one without a shell fails outright.
  await run(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
      '-i', path.join(SRC, 'styles.css'),
      '-o', path.join(OUT, 'styles.css'),
      '--minify',
    ],
    { cwd: ROOT }
  );
  process.stdout.write('  styles.css\n');

  if (existsSync(path.join(ROOT, 'public'))) {
    await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
  }

  const toolsOut = path.join(ROOT, '..', 'tools', 'out');
  if (existsSync(toolsOut)) {
    await cp(toolsOut, path.join(OUT, 'rentwise'), { recursive: true });
    process.stdout.write('  rentwise/ (from tools/out)\n');
  }
}

await build();
process.stdout.write('Site built to site/dist\n');
process.stdout.write(
  HAS_APP ? `  Sign in → ${APP_URL}\n` : '  Sign in button omitted (APP_URL=none)\n'
);
if (!process.env.APP_URL) {
  process.stdout.write('  (APP_URL unset — do not publish this build)\n');
}

if (process.argv.includes('--watch')) {
  const { default: chokidar } = await import('chokidar');
  chokidar.watch(SRC, { ignoreInitial: true }).on('all', async () => {
    try {
      await build();
    } catch (err) {
      console.error(err.message);
    }
  });
  process.stdout.write('Watching src/…\n');
}
