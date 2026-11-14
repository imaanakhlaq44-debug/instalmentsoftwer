#!/usr/bin/env node
/**
 * Cut long narration recordings into one clip per paragraph.
 *
 *   node scripts/video/stt.mjs audio/1.mp3 build/stt/1.json urd
 *   node scripts/video/cuts.mjs
 *
 * The narration was recorded as four long files rather than sixty clips, and
 * the reader announced the structure out loud as he went — "part two", "ten" —
 * which belongs in a script and not in a film. So each recording is aligned
 * against the written script word by word: a paragraph's clip runs from its
 * own first word to its own last word, and everything the reader said between
 * two paragraphs (the number, the part heading, a throat clear, a breath) sits
 * outside every clip and is therefore gone from the film.
 *
 * Alignment, not silence detection: a recording with room tone in it has no
 * silence to detect — a first attempt found two gaps in four minutes.
 *
 * The clips land where build.mjs expects them, so after this the film is one
 * command away and the picture follows the voice with no retiming by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.VIDEO_ROOT || 'E:/Almas/almas_app/installment softwer/videos';
const AUDIO = process.env.VIDEO_AUDIO || 'E:/Almas/almas_app/installment softwer/audio';
const STT = process.env.VIDEO_STT || path.join(ROOT, 'build', 'stt');
const SCRIPT = process.env.VIDEO_SCRIPT || 'docs/video/narration/script-urdu.md';

/** Which parts each recording holds, in the order they are spoken. */
const RECORDINGS = [
  ['1.mp3', [1, 2]],
  ['2.mp3', [3]],
  ['3.mp3', [4]],
  ['4.mp3', [5]],
];

/** Breathing room around a clip, so a cut never clips a consonant. */
const PAD_IN = 0.07;
const PAD_OUT = 0.12;

// ------------------------------------------------------------------ words --

/**
 * One spoken word, reduced to what two renderings of it have in common:
 * punctuation, the Urdu diacritics a reader may or may not pronounce, and the
 * letters that have more than one accepted code point all go.
 */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u0649\u064A]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0647/g, '\u06C1')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Two renderings of the same word: equal, or one written inside the other —
 * "Almas SDM" comes back from the transcriber as the single word "AlmasDM".
 */
const near = (a, b) =>
  a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));

/**
 * What the reader said to keep his place in the script, and what must not be
 * in the film: the paragraph numbers and the word that opens a part heading.
 * The gap between two paragraphs is cut at the first of these, so a word the
 * reader changed on the day ("کر لیجیے" read as "کر لیں") still stays in.
 */
const MARKERS = new Set(
  (
    'حصہ ایک دو تین چار پانچ چھ چھے سات آٹھ نو دس دسویں گیارہ بارہ تیرہ چودہ ' +
    'پندرہ سولہ سترہ اٹھارہ انیس بیس'
  )
    .split(' ')
    .concat(Array.from({ length: 20 }, (_, i) => String(i + 1)))
    .map(norm),
);

/**
 * A word the transcriber ran into the next one across a full stop —
 * "چاہیے。سات،" — split on that stop, with the time shared out by length.
 * Left whole, the number glued to it would survive the cut.
 */
function split(words) {
  const out = [];
  for (const w of words) {
    const pieces = w.text.split(/(?<=[۔。؟!،])(?=\S)/u);
    if (pieces.length < 2) {
      out.push(w);
      continue;
    }
    const chars = pieces.reduce((n, p) => n + p.length, 0);
    let at = w.start;
    for (const piece of pieces) {
      const end = at + ((w.end - w.start) * piece.length) / chars;
      out.push({ ...w, text: piece, start: at, end });
      at = end;
    }
  }
  return out;
}

/** The script's paragraphs, by part, exactly as build.mjs numbers them. */
function script() {
  const parts = {};
  let part = null;
  let para = null;
  for (const line of fs.readFileSync(SCRIPT, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^##\s/);
    const numbered = line.match(/^\*\*(\d+)\.\*\*\s*$/);
    if (heading) {
      part = (Number(Object.keys(parts).at(-1)) || 0) + 1;
      parts[part] = [];
      para = null;
    } else if (numbered && part) {
      para = [];
      parts[part].push(para);
    } else if (para && line.trim()) {
      para.push(line.trim());
    }
  }
  return Object.fromEntries(
    Object.entries(parts).map(([p, paras]) => [p, paras.map((lines) => lines.join(' '))]),
  );
}

// -------------------------------------------------------------- alignment --

/**
 * Walk one paragraph's words through the transcript and return the span the
 * reader actually spoke it in. Small differences are expected and tolerated —
 * he says "Almas SDM" where the transcript hears "AlmasDM" — so a word may be
 * skipped on either side; what must hold is the order.
 */
function locate(words, text, cursor) {
  const want = text.split(/\s+/).map(norm).filter(Boolean);

  // The start: the first place from here where three of the paragraph's
  // opening words line up, in order and within a few words. Three, because
  // one word on its own repeats all over a nine-minute script.
  const score = (i) => {
    let hit = 0;
    let j = i;
    for (let k = 0; k < Math.min(5, want.length); k++) {
      for (let q = j; q < Math.min(i + 7, words.length); q++) {
        if (near(words[q].n, want[k])) {
          hit++;
          j = q + 1;
          break;
        }
      }
    }
    return hit;
  };
  const need = Math.min(3, want.length);
  let start = -1;
  for (let i = cursor; i < words.length && start < 0; i++) {
    if (near(words[i].n, want[0]) && score(i) >= need) start = i;
  }
  for (let i = cursor; i < words.length && start < 0; i++) {
    if (score(i) >= Math.min(4, want.length)) start = i;
  }
  if (start < 0) throw new Error('could not place paragraph: ' + text.slice(0, 40));

  // The end: consume the paragraph greedily, remembering the last word that
  // matched. Anything after it belongs to the reader, not to the script.
  let last = start;
  let i = start;
  for (const w of want) {
    let found = -1;
    for (let k = i; k < Math.min(i + 4, words.length); k++) if (near(words[k].n, w)) { found = k; break; }
    if (found < 0) continue;
    last = found;
    i = found + 1;
  }
  return { start, last };
}

// ------------------------------------------------------------------- cuts --

const paragraphs = script();
const report = [];
let total = 0;

for (const [file, parts] of RECORDINGS) {
  const src = path.join(AUDIO, file);
  const json = path.join(STT, file.replace(/\.mp3$/, '.json'));
  if (!fs.existsSync(json)) throw new Error('no transcript: ' + json + ' — run stt.mjs first');
  const words = split(JSON.parse(fs.readFileSync(json, 'utf8')).words.filter((w) => w.type === 'word'))
    .map((w) => ({ ...w, n: norm(w.text) }))
    .filter((w) => w.n);

  // Place every paragraph of every part this recording holds, in order.
  const found = [];
  let cursor = 0;
  for (const part of parts) {
    const paras = paragraphs[part];
    if (!paras) throw new Error('script has no part ' + part);
    paras.forEach((text, idx) => {
      const at = locate(words, text, cursor);
      found.push({ part, n: idx + 1, ...at });
      cursor = at.last + 1;
    });
  }

  // Then decide where each clip ends. The gap to the next paragraph is the
  // reader keeping his place out loud; it is cut at the first number or part
  // heading in it, and anything before that is script he read slightly
  // differently from the page, so it stays in his clip.
  found.forEach((p, i) => {
    const until = found[i + 1] ? found[i + 1].start : words.length;
    let keep = p.last;
    for (let k = p.last + 1; k < until; k++) {
      if (MARKERS.has(words[k].n)) break;
      keep = k;
    }
    p.keep = keep;
    p.after = words.slice(keep + 1, until).map((w) => w.text).join(' ');
    p.before = i ? '' : words.slice(0, p.start).map((w) => w.text).join(' ');
  });

  for (const p of found) {
    const dir = path.join(ROOT, 'narration', 'p' + p.part);
    fs.mkdirSync(dir, { recursive: true });
    // Pad for breathing room, but never back into what was dropped before the
    // clip, nor forward into what was dropped after it.
    const prev = words[p.start - 1];
    const next = words[p.keep + 1];
    const from = Math.max(prev ? prev.end : 0, words[p.start].start - PAD_IN);
    const to = Math.min(next ? next.start : words[p.keep].end + PAD_OUT, words[p.keep].end + PAD_OUT);
    const out = path.join(dir, String(p.n).padStart(2, '0') + '.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', from.toFixed(3), '-to', to.toFixed(3),
      '-i', src,
      '-af', 'afade=t=in:d=0.03,afade=t=out:st=' + Math.max(0, to - from - 0.06).toFixed(3) + ':d=0.06',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', out], { stdio: 'inherit' });
    total += to - from;
    report.push({
      ...p,
      length: to - from,
      said: words.slice(p.start, p.keep + 1).map((w) => w.text).join(' '),
    });
  }
}

for (const r of report) {
  if (r.before) console.log('  cut  ' + r.before);
  console.log(
    'p' + r.part + '/' + String(r.n).padStart(2, '0') + '  ' + r.length.toFixed(2) + 's  ' +
    r.said.slice(0, 60),
  );
  if (r.after) console.log('  cut  ' + r.after);
}
console.log('\n' + report.length + ' clips, ' + total.toFixed(1) + 's of voice');
