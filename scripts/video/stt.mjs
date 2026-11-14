#!/usr/bin/env node
/**
 * Transcribe a narration recording with word timestamps.
 *
 *   node scripts/video/stt.mjs <audio file> <out.json> [language]
 *
 * This is the other half of tts.mjs, and it exists for one reason: when the
 * narration arrives as one long recording per part instead of one clip per
 * paragraph, something has to find the paragraph boundaries. Guessing them
 * from silence does not work on a recording with any room tone in it, and
 * guessing them from character counts drifts. The word timestamps do work,
 * and they also show where the reader said things that must not be in the
 * film — "paragraph four", "part two" — so cuts.mjs can drop them.
 *
 * The key is read exactly as tts.mjs reads it, from E:\Almas\keys and never
 * from the repository, and errors report the HTTP status only so that an error
 * echo cannot carry the key back into a log.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v1';

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
    if (file.endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.key) return String(parsed.key).trim();
      } catch {
        // A malformed file is simply not a key source.
      }
      continue;
    }
    return raw;
  }
  throw new Error('No API key. Set ELEVENLABS_API_KEY or put it in ' + KEY_FILES.join(', '));
}

const [input, output, language] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/video/stt.mjs <audio file> <out.json> [language]');
  process.exit(2);
}

const form = new FormData();
form.append('file', new Blob([fs.readFileSync(input)]), path.basename(input));
form.append('model_id', MODEL);
form.append('timestamps_granularity', 'word');
form.append('diarize', 'false');
if (language) form.append('language_code', language);

const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
  method: 'POST',
  headers: { 'xi-api-key': readKey() },
  body: form,
});
if (!res.ok) throw new Error('ElevenLabs returned ' + res.status + ' ' + res.statusText);

const data = await res.json();
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(data, null, 1));
const words = (data.words || []).filter((w) => w.type === 'word');
console.log(input + ': ' + data.language_code + ', ' + words.length + ' words -> ' + output);
