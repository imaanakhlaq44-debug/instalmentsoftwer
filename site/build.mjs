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
  const layout = await readFile(path.join(SRC, 'layout.html'), 'utf8');
  const pages = (await readdir(path.join(SRC, 'pages'))).filter((f) => f.endsWith('.html'));

  await mkdir(OUT, { recursive: true });

  for (const file of pages) {
    const raw = await readFile(path.join(SRC, 'pages', file), 'utf8');
    const meta = readMeta(raw);
    const body = raw.replace(/<!--\s*meta[\s\S]*?-->/, '').trim();

    const html = layout
      .replaceAll('{{title}}', meta.title ?? 'Almas SDM')
      .replaceAll('{{titleUr}}', meta.titleUr ?? meta.title ?? 'Almas SDM')
      .replaceAll('{{description}}', meta.description ?? '')
      .replaceAll('{{page}}', meta.page ?? '')
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
}

await build();
process.stdout.write('Site built to site/dist\n');

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
