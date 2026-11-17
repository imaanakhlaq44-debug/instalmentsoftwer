import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/ocr');
await mkdir(out, { recursive: true });
await copyFile(resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'), resolve(out, 'worker.min.js'));
for (const name of await readdir(resolve(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*\.(wasm|js)$/.test(name)) await copyFile(resolve(root, 'node_modules/tesseract.js-core', name), resolve(out, name));
}
for (const lang of ['eng', 'urd']) {
  await copyFile(resolve(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), resolve(out, `${lang}.traineddata.gz`));
}
console.log('Self-hosted English/Urdu OCR assets ready.');
