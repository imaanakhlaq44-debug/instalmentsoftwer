#!/usr/bin/env node
/**
 * Render one voiceover part to mp3 with ElevenLabs.
 *
 * The app itself has no text-to-speech in it and never will — this is a
 * build-time tool for the guide video, kept here so the next remake does not
 * start from nothing (the first video's pipeline was never saved).
 *
 *   node scripts/video/tts.mjs part3.txt out/3.mp3
 *
 * The API key is read from, in order:
 *   1. $ELEVENLABS_API_KEY
 *   2. the file named by $ELEVENLABS_API_KEY_FILE
 *   3. ~/.elevenlabs/key.txt
 *
 * It is never printed, never written to the repository, and must not be pasted
 * into a chat or a tracked file. Voice and model come from $ELEVENLABS_VOICE_ID
 * and $ELEVENLABS_MODEL (default eleven_multilingual_v2, which speaks Urdu).
 *
 * Input text should be in Urdu script for Urdu narration — Roman Urdu is read
 * as English by every engine tried so far.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
/** Paragraphs are sent separately so one bad line can be re-rendered alone. */
const MAX_CHARS = 2400;

/**
 * Candidate key locations, in order. All of them are outside every repository
 * on purpose; `E:\Almas\keys` is where this machine keeps its signing keys and
 * API keys, so the video tooling looks there too.
 */
const KEY_FILES = [
  process.env.ELEVENLABS_API_KEY_FILE,
  'E:/Almas/keys/key.txt',
  'E:/Almas/keys/elevenlabs.json',
  path.join(os.homedir(), '.elevenlabs', 'key.txt'),
].filter(Boolean);

function readKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  for (const file of KEY_FILES) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) continue;
    // A .json file keeps the key under "key"; a .txt file is the key itself.
    if (file.endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.key) return String(parsed.key).trim();
      } catch {
        // Fall through: a malformed file is simply not a key source.
      }
      continue;
    }
    return raw;
  }
  throw new Error(
    `No API key. Set ELEVENLABS_API_KEY, or put the key in one of: ${KEY_FILES.join(', ')} — ` +
      'never in the repository.',
  );
}

/** Split on blank lines, then merge back up to MAX_CHARS so prosody survives. */
function chunk(text) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out = [];
  for (const p of paras) {
    if (out.length && (out[out.length - 1] + ' ' + p).length <= MAX_CHARS) {
      out[out.length - 1] += ' ' + p;
    } else {
      out.push(p);
    }
  }
  return out;
}

async function speak(key, voiceId, text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1 },
      }),
    },
  );
  if (!res.ok) {
    // The body can carry the key back in an error echo; report status only.
    throw new Error(`ElevenLabs returned ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const args = process.argv.slice(2);
const split = args.includes('--split');
const [input, output] = args.filter((a) => a !== '--split');
if (!input || !output) {
  console.error('usage: node scripts/video/tts.mjs [--split] <text file> <output mp3 | directory>');
  process.exit(2);
}

const voiceFile = process.env.ELEVENLABS_VOICE_FILE || 'E:/Almas/keys/voice.txt';
const voiceId =
  process.env.ELEVENLABS_VOICE_ID ||
  (fs.existsSync(voiceFile) ? fs.readFileSync(voiceFile, 'utf8').trim() : '');
if (!voiceId) {
  console.error(
    `Set ELEVENLABS_VOICE_ID, or put the voice id in ${voiceFile} — ` +
      'the voice you picked in the ElevenLabs library.',
  );
  process.exit(2);
}

const key = readKey();

// --split writes one mp3 per paragraph into a directory instead of one file
// for the whole part. The guide video's shots are cut to the paragraph they
// illustrate, and a measured paragraph is the only way the picture and the
// voice can be exactly in step; an estimate from character counts drifts,
// because Devanagari, Latin and Urdu script run at different speeds.
const pieces = split
  ? fs
      .readFileSync(input, 'utf8')
      .split(/\n{2,}/)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  : chunk(fs.readFileSync(input, 'utf8'));
console.log(`${input}: ${pieces.length} piece(s), ${pieces.join(' ').length} characters`);

if (split) {
  fs.mkdirSync(output, { recursive: true });
  for (const [i, piece] of pieces.entries()) {
    const file = path.join(output, String(i + 1).padStart(2, '0') + '.mp3');
    if (fs.existsSync(file) && !process.env.TTS_FORCE) {
      console.log(`  ${i + 1}/${pieces.length} kept (already rendered)`);
      continue;
    }
    process.stdout.write(`  ${i + 1}/${pieces.length} … `);
    fs.writeFileSync(file, await speak(key, voiceId, piece));
    console.log('ok');
  }
  console.log(`wrote ${pieces.length} files to ${output}`);
} else {
  const buffers = [];
  for (const [i, piece] of pieces.entries()) {
    process.stdout.write(`  chunk ${i + 1}/${pieces.length} … `);
    buffers.push(await speak(key, voiceId, piece));
    console.log('ok');
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.concat(buffers));
  console.log(`wrote ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB)`);
  console.log('Concatenated MP3 frames play fine, but re-encode before editing:');
  console.log(`  ffmpeg -i ${output} -c:a libmp3lame -b:a 128k ${output.replace(/\.mp3$/, '')}-clean.mp3`);
}
