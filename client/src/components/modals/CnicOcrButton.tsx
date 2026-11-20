import { useEffect, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';
import { CnicFields, parseCnicText } from '../../utils/cnicOcr.js';
import type { Worker } from 'tesseract.js';

export function CnicOcrButton({ onApply }: { onApply: (fields: CnicFields) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [fields, setFields] = useState<CnicFields>({ cnic: '', name: '', address: '' });
  const [read, setRead] = useState(false);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const stop = () => { generation.current++; working.current = false; const current = worker.current; worker.current = null; void current?.terminate().catch(() => undefined); };
  useEffect(() => () => stop(), []);
  const close = () => { stop(); setBusy(false); setOpen(false); setText(''); setRead(false); setFields({ cnic: '', name: '', address: '' }); setError(''); };

  const scan = async (file: File | undefined) => {
    if (!file || working.current) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP photo smaller than 15 MB.'); return;
    }
    working.current = true; setBusy(true); setError('');
    const run = generation.current;
    let bitmap: ImageBitmap | undefined;
    try {
      setProgress('Preparing card photo…');
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 50_000_000) throw new Error('This photo is too large. Take a smaller, clear card photo.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(2, 2000 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image reading is not supported in this browser.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (run !== generation.current) return;
      if (!worker.current) {
        const { createWorker } = await import('tesseract.js');
        const base = new URL('/ocr/', window.location.origin).href;
        const created = await createWorker(['eng', 'urd'], 1, {
          workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''),
          workerBlobURL: false,
          logger: message => { if (run === generation.current) setProgress(`Reading card… ${Math.round(message.progress * 100)}%`); },
        });
        if (run !== generation.current) { await created.terminate(); return; }
        worker.current = created;
      }
      const result = await worker.current.recognize(canvas);
      if (run !== generation.current) return;
      const combined = [text, result.data.text].filter(Boolean).join('\n');
      setText(combined); setFields(parseCnicText(combined)); setRead(true);
      if (!result.data.text.trim()) setError('No readable text found. Try a clear, straight photo without glare.');
    } catch (e) {
      if (run === generation.current) setError(e instanceof Error ? e.message : 'Could not read the card. Retake the photo or type the details.');
    } finally {
      bitmap?.close();
      if (run === generation.current) { working.current = false; setBusy(false); setProgress(''); }
    }
  };
  return <>
    <button type="button" className="btn-secondary" onClick={() => setOpen(true)}><ScanLine className="h-4 w-4" /> Scan CNIC</button>
    {open && <div className="fixed inset-0 z-[110] overflow-y-auto bg-ink-900/60 p-4" role="dialog" aria-modal="true" aria-label="Scan customer CNIC"><div className="surface mx-auto my-8 max-w-xl p-5">
      <header className="flex items-center justify-between"><h3 className="text-title font-black">Scan customer CNIC</h3><button type="button" aria-label="Close CNIC scan" className="btn-ghost" onClick={close}><X /></button></header>
      <p className="my-3 text-caption">With the customer’s permission, photograph the front, then the back of the card. Keep it straight, well lit and fill the frame. Photos are read in this browser and are not uploaded.</p>
      <label className="btn-secondary inline-flex cursor-pointer">{busy ? 'Reading…' : 'Take / choose card photo'}<input aria-label="Card photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={busy} onChange={e => { void scan(e.target.files?.[0]); e.target.value = ''; }} /></label>
      {progress && <p role="status" className="mt-3 text-caption">{progress}</p>}
      {error && <p role="alert" className="mt-3 text-caption text-critical-700">{error}</p>}
      {read && <div className="mt-4 space-y-3"><p className="text-caption font-bold">Check and correct the details against the original card before applying.</p>
        <label className="block field-label">CNIC number<input className="input mt-1" value={fields.cnic} onChange={e => setFields({ ...fields, cnic: e.target.value })} /></label>
        <label className="block field-label">Full name<input className="input mt-1" dir="auto" value={fields.name} onChange={e => setFields({ ...fields, name: e.target.value })} /></label>
        <label className="block field-label">Home address<textarea className="input mt-1" dir="auto" value={fields.address} onChange={e => setFields({ ...fields, address: e.target.value })} /></label>
        <details><summary className="cursor-pointer text-caption">View text read from card</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-caption" dir="auto">{text}</pre></details>
        <p className="text-caption">Mobile and emergency contact numbers are entered separately. This reads the card; it does not verify it with NADRA.</p>
        <button type="button" className="btn-primary" disabled={busy || fields.cnic.replace(/\D/g, '').length !== 13} onClick={() => { onApply(fields); close(); }}>Confirm and fill customer details</button>
      </div>}
    </div></div>}
  </>;
}
