# Guide video narration

Two kinds of file live here.

| File | What it is |
|---|---|
| `script-urdu.md`, `script-english.md` | the narration for a **person** to record, numbered paragraph by paragraph |
| `1-tts.txt` … `5-tts.txt` | the same narration spelled for a **speech engine**, which reads a mixed script better than plain Urdu |

The engine's version was used for the first cut of the v2 video. It is kept
because it still works and costs nothing but API characters, but a recorded
human voice is better and the two are interchangeable: the parts and the
paragraph numbers are identical in all of them.

## Recording it as a few long files

This is how the voice in the finished video was recorded: four long files, read
from `script-urdu.md`, with the numbers and the part headings read out loud to
keep the reader's place.

```
audio/1.mp3   parts 1 and 2
audio/2.mp3   part 3
audio/3.mp3   part 4
audio/4.mp3   part 5
```

Two commands turn that into the sixty clips the build wants:

```
node scripts/video/stt.mjs "E:/Almas/almas_app/installment softwer/audio/1.mp3" "E:/Almas/almas_app/installment softwer/videos/build/stt/1.json" urd
node scripts/video/cuts.mjs
```

`stt.mjs` transcribes with word timestamps; `cuts.mjs` lines those words up
against `script-urdu.md` and cuts each paragraph from its own first word to its
own last word. So **"paragraph four", "part two", a throat clear between two
paragraphs are all outside every clip** and never reach the film, while a word
read differently from the page — `کر لیجیے` read as `کر لیں` — stays in.
`RECORDINGS` at the top of `cuts.mjs` says which parts each file holds, and the
run prints every clip with what was cut before and after it, which is the thing
to read before trusting the result.

Silence detection was tried first and does not work: a recording with any room
tone in it had two detectable gaps in four minutes, for nineteen paragraphs.

## Recording it one clip at a time

**One mp3 per paragraph**, named by its number, in a folder per part:

```
videos/narration/p1/01.mp3   part 1, paragraph 1
videos/narration/p1/02.mp3
...
videos/narration/p3/19.mp3   part 3, paragraph 19
```

Parts hold 9, 10, 19, 12 and 10 paragraphs — 60 clips in all.

Per-paragraph files are not fussiness. `scripts/video/build.mjs` ties every
shot to the paragraphs it illustrates and measures those clips, so the picture
follows the voice with no retiming by hand; and a line that comes out wrong is
re-recorded on its own instead of the whole part. Leave no silence at the start
or end of a clip — the build inserts the pause between paragraphs itself.

Then rebuild:

```
node scripts/video/build.mjs
```

It prints the drift it achieved at the end; anything under about 50ms is in
step. If a paragraph has no clip, it stops and names the one it is missing.

**Do not renumber the paragraphs.** Splitting one in two, or merging two, needs
the matching change in `PARTS` in `build.mjs` — otherwise a shot sits on the
wrong words.

## Rendering it with the engine instead

```
node scripts/video/tts.mjs --split docs/video/narration/3-tts.txt "E:/Almas/.../videos/narration/p3"
```

Without `--split` it writes one mp3 for the whole part, which is what the
first attempt did; the picture then has to be timed by guesswork, and it drifts
ahead of the voice. Use `--split`.

## How the engine's text is written


Three scripts in one file, on purpose — it is what the engine pronounces best,
and what a Pakistani shopkeeper actually says:

| Written in | For | Example |
|---|---|---|
| Urdu script | greetings and religious phrases | `السلام علیکم`, `اللہ حافظ` |
| English | words everyone says in English | lock, dashboard, IMEI, layers, agreement, CNIC, check-in, QR, device owner |
| Devanagari | everything else | `अब वो सवाल जो हर दुकानदार पूछता है` |

Urdu script for whole sentences was tried first and read badly; plain Devanagari
read correctly but turned English product terms into something a shopkeeper
would not recognise. The mix is the version that was approved.

**Keep technical words in English.** A literal Urdu translation of *layers*,
*agreement* or *check-in* is understood by nobody at a mobile counter.

## Captions

Burned-in captions are written in Urdu script, in Jameel Noori Nastaleeq — these
files are what is *spoken*, not what is *shown*. Write the caption text from the
final audio, so the two never drift apart.

## The claim that must not change

Part 3 says IMEI change is **caught** — `پکڑا جاتا ہے`, `पकड़ा जाता है`,
"it gets caught" — never that it is
impossible. No fleet of real handsets has been tested yet, and a shop that
believes a phone can never be freed will lend against it.
