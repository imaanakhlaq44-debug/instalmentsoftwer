# Guide video narration

One file per voiceover part, in the order they are spoken. `scripts/video/tts.mjs`
renders each one to an mp3 with the voice in `E:\Almas\keys\voice.txt`.

```
node scripts/video/tts.mjs docs/video/narration/3-tts.txt "E:/Almas/.../videos/narration/3.mp3"
```

## How the text is written

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

Part 3 says IMEI change is **caught** (`पकड़ा जाता है`), never that it is
impossible. No fleet of real handsets has been tested yet, and a shop that
believes a phone can never be freed will lend against it.
