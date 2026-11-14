#!/usr/bin/env node
/**
 * Assemble the long guide video: stills + title cards + the narration.
 *
 *   node scripts/video/slides.mjs
 *   node scripts/video/lockscreen.mjs
 *   node scripts/video/shots.mjs
 *   node scripts/video/tts.mjs --split docs/video/narration/N-tts.txt .../narration/pN
 *   node scripts/video/build.mjs
 *
 * Every shot is cut to the paragraphs of narration it illustrates, and each of
 * those paragraphs is its own mp3, so a shot's length is measured rather than
 * guessed. Two earlier attempts guessed — first by hand, then from character
 * counts — and both ran the picture ahead of the voice, because Devanagari,
 * Latin and Urdu script take very different times to say per character.
 *
 * Re-record the narration and the picture follows it; nothing here needs
 * retiming by hand.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = process.env.VIDEO_ROOT || 'E:/Almas/almas_app/installment softwer/videos';
const SLIDES = path.join(ROOT, 'slides');
const VOICE = path.join(ROOT, 'narration');
const WORK = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'Almas SDM - Guide (Urdu) v2.mp4');
/** The spoken text, which the paragraph numbering below refers to. */
const SCRIPTS = process.env.VIDEO_SCRIPTS || 'docs/video/narration';

const FPS = 30;
/** Breath before the first word. Long enough to read the logo, short enough
 *  that nobody waits: five seconds felt like the voice had fallen behind. */
const LEAD = 1.2;
/** Pause left between paragraphs, since each is rendered on its own. */
const GAP = 0.35;

/**
 * [file, paragraphs] — the paragraphs of that part's narration this shot is on
 * screen for, numbered from 1 as they appear in docs/video/narration/N-tts.txt.
 */
const PARTS = {
  1: [
    ['slides/00-intro', [1]],
    ['slides/10-problem', [2]],
    ['stills/03-dashboard', [3]],
    ['stills/02-register', [4]],
    ['stills/01-login', [5]],
    ['stills/03-dashboard', [6]],
    ['stills/04-settings', [7]],
    ['stills/05-settings-frp', [8]],
    ['stills/03-dashboard', [9]],
  ],
  2: [
    ['stills/06-licenses', [1]],
    ['stills/09-sale-form', [2]],
    ['stills/08-customers', [3]],
    ['stills/09-sale-form', [4]],
    ['stills/14-installments', [5]],
    ['stills/10-enrollment-qr', [6, 7]],
    ['stills/09-sale-form', [8, 9]],
    ['stills/11-devices', [10]],
  ],
  3: [
    ['slides/30-imei-question', [1]],
    ['slides/35-layers-all', [2]],
    ['slides/31-layer-1', [3]],
    ['stills/09-sale-form', [4]],
    ['stills/10-enrollment-qr', [5]],
    ['slides/32-layer-2', [6]],
    ['stills/11-devices', [7]],
    ['stills/12-device-tamper', [8]],
    ['slides/33-layer-3', [9, 10, 11]],
    ['stills/13-notifications', [12]],
    ['slides/34-layer-4', [13, 14]],
    ['stills/11-devices', [15]],
    ['stills/12-device-tamper', [16]],
    ['slides/35-layers-all', [17, 18]],
    ['stills/13-notifications', [19]],
  ],
  4: [
    ['stills/11-devices', [1]],
    ['stills/22-lock-screen', [2, 3]],
    ['stills/11-devices', [4]],
    ['stills/15-payments', [5, 6]],
    ['stills/16-transactions', [7]],
    ['stills/14-installments', [8]],
    ['stills/13-notifications', [9]],
    ['stills/08-customers', [10]],
    ['stills/14-installments', [11, 12]],
  ],
  5: [
    ['stills/04-settings', [1, 2]],
    ['stills/17-handset-tests', [3]],
    ['stills/10-enrollment-qr', [4]],
    ['stills/11-devices', [5]],
    ['stills/18-audit-logs', [6]],
    ['stills/20-platform-shops', [7]],
    ['stills/06-licenses', [8]],
    ['slides/99-outro', [9, 10]],
  ],
};

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const seconds = (file) =>
  Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ]).toString().trim(),
  );

/** The paragraphs of one part's narration, numbered from 1. */
const paragraphs = (part) =>
  fs
    .readFileSync(path.join(SCRIPTS, part + '-tts.txt'), 'utf8')
    .split(new RegExp('\\r?\\n\\s*\\r?\\n'))
    .map((t) => t.trim())
    .filter(Boolean);

/** That paragraph's own mp3. */
const clip = (part, n) => path.join(VOICE, 'p' + part, String(n).padStart(2, '0') + '.mp3');

// ---------------------------------------------------------------- the plan --

/** The voice, in order, as it will be laid down. */
const voice = [];
/** [image, end second, label] — each shot ends where its last paragraph ends. */
const cuts = [];

let clock = LEAD;
for (const [part, shots] of Object.entries(PARTS)) {
  const said = paragraphs(part);
  const covered = shots.flatMap(([, ps]) => ps);
  const missing = said.map((_, i) => i + 1).filter((i) => !covered.includes(i));
  if (missing.length) throw new Error('part ' + part + ': no shot for paragraph ' + missing.join(', '));

  for (const [file, ps] of shots) {
    const src = path.join(ROOT, file + '.png');
    if (!fs.existsSync(src)) throw new Error('missing image: ' + src);
    for (const n of ps) {
      const mp3 = clip(part, n);
      if (!fs.existsSync(mp3)) throw new Error('missing narration: ' + mp3);
      voice.push(mp3);
      clock += seconds(mp3) + GAP;
    }
    cuts.push([src, clock, 'part ' + part + '  ' + file.padEnd(24) + ' \u00b6' + ps.join(',')]);
  }
}

// ------------------------------------------------------------- the picture --

/**
 * zoompan runs on one core and costs about a second of CPU per second of
 * output, which puts a nine-minute film out of reach here; a clean cut also
 * keeps dashboard text sharper than any resampled zoom. VIDEO_PUSH=1 brings
 * the slow Ken Burns push back.
 */
const PUSH = process.env.VIDEO_PUSH === '1';
const WORKERS = Number(process.env.VIDEO_WORKERS || os.cpus().length);

const encode = (args) =>
  new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error('ffmpeg exited ' + code))));
  });

const pool = async (list) => {
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < list.length) {
      const i = next++;
      await list[i].run();
      console.log('[' + ++done + '/' + list.length + '] ' + list[i].label);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, list.length) }, run));
};

const push = (frames, i) => {
  const dir = i % 2 ? 'max(1.04-on*0.04/' + frames + ',1)' : 'min(1+on*0.04/' + frames + ',1.04)';
  return `scale=2112:-2,zoompan=z='${dir}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${FPS},setsar=1`;
};
const flat = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=0xFFF8E8,setsar=1';

fs.mkdirSync(WORK, { recursive: true });
const segments = [];
const jobs = [];

// Cut on frame boundaries taken from the clock, not from each shot's own
// length: rounding then cannot accumulate, and the last shot still lands on
// the last word.
let at = 0;
cuts.forEach(([src, end, label], i) => {
  const frames = Math.round(end * FPS) - at;
  at += frames;
  const out = path.join(WORK, 'seg-' + String(i + 1).padStart(3, '0') + '.mp4');
  segments.push(out);
  jobs.push({
    label: label + '  ' + (frames / FPS).toFixed(2) + 's',
    run: () =>
      encode(['-loop', '1', '-i', src, '-frames:v', String(frames),
        '-vf', PUSH ? push(frames, i) : flat, '-r', String(FPS),
        '-c:v', 'libx264', ...(PUSH ? ['-preset', 'veryfast', '-crf', '23']
          : ['-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage']),
        '-pix_fmt', 'yuv420p', out]),
  });
});

await pool(jobs);

const concatFile = (file, entries) =>
  fs.writeFileSync(file, entries.map((s) => "file '" + s.replace(/'/g, "'\\''") + "'").join('\n'));

const picture = path.join(WORK, 'picture.mp4');
concatFile(path.join(WORK, 'segments.txt'), segments);
ff(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'segments.txt'), '-c', 'copy', picture]);

// --------------------------------------------------------------- the voice --

const silence = (sec, file) => {
  ff(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(sec),
      '-c:a', 'libmp3lame', '-b:a', '128k', file]);
  return file;
};
const lead = silence(LEAD, path.join(WORK, 'lead.mp3'));
const gap = silence(GAP, path.join(WORK, 'gap.mp3'));

const track = path.join(WORK, 'voice.mp3');
concatFile(path.join(WORK, 'voice.txt'), [lead, ...voice.flatMap((v) => [v, gap])]);
ff(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'voice.txt'),
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', track]);

ff(['-i', picture, '-i', track, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT]);

const shown = seconds(picture);
const spoken = seconds(track);
console.log('\npicture ' + shown.toFixed(2) + 's   voice ' + spoken.toFixed(2) + 's   drift ' +
  ((shown - spoken) * 1000).toFixed(0) + 'ms');
console.log(OUT);
console.log(seconds(OUT).toFixed(1) + 's  ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + ' MB');
