import { useEffect, useRef, useState } from 'react';
import { QrCode, Maximize2, X } from 'lucide-react';
import { ApiService } from '../../services/api.js';

export type ScannedPhone = { brand: string; model: string; imeis?: string[]; serialNumber?: string; osVersion?: string };
type Session = Awaited<ReturnType<typeof ApiService.createPhoneIntake>>;

export function PhoneIntakeScan({ dealerId, disabled, onPhone, onPending, onClear }: {
  dealerId?: string; disabled: boolean;
  onPhone: (id: string, phone: ScannedPhone) => void;
  onPending: (pending: boolean) => void;
  onClear: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const delivered = useRef(false);
  const callbacks = useRef({ onPhone, onPending, onClear });
  callbacks.current = { onPhone, onPending, onClear };
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await ApiService.getPhoneIntake(session.id);
        if (cancelled) return;
        setError(''); setStatus(result.status);
        if (result.status === 'EXPIRED') { callbacks.current.onPending(false); callbacks.current.onClear(); return; }
        if (result.status === 'RECEIVED' && result.report && !delivered.current) {
          delivered.current = true;
          callbacks.current.onPhone(session.id, result.report);
          callbacks.current.onPending(false);
          setFull(false);
          return;
        }
      } catch { if (!cancelled) setError('Connection interrupted. Retrying the phone scan…'); }
      if (!cancelled) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session]);

  const cancel = async () => {
    if (!session || busy || disabled) return;
    setBusy(true);
    try {
      await ApiService.revokeEnrollmentToken(session.tokenId);
      setSession(null); setFull(false); setError(''); setStatus('');
      callbacks.current.onClear(); callbacks.current.onPending(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel the scan. Try again.'); }
    finally { setBusy(false); }
  };
  const start = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const created = await ApiService.createPhoneIntake(dealerId);
      delivered.current = false; setSession(created); setStatus('WAITING');
      callbacks.current.onPending(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the phone QR.'); }
    finally { setBusy(false); }
  };
  return <div className="rounded-xl border-2 border-ink-900 bg-mint-50 p-4">
    {!session && <button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => void start()}><QrCode className="h-4 w-4" /> {busy ? 'Preparing QR…' : 'Scan new phone from Welcome screen'}</button>}
    {error && <p role="alert" className="mt-2 text-caption text-critical-700">{error}</p>}
    {session && <>
      <p className="font-bold" role="status">{status === 'RECEIVED' ? 'Phone details filled — review them, then register the sale.' : status === 'EXPIRED' ? 'QR expired. Cancel and create a new QR.' : 'Waiting for the new phone…'}</p>
      {status === 'WAITING' && <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <button type="button" onClick={() => setFull(true)} aria-label="Show phone scan QR full screen" className="shrink-0 rounded-lg bg-white p-2"><img src={session.qrImageDataUrl} alt="Welcome-screen phone enrollment QR" className="h-48 w-48" /><span className="flex items-center justify-center gap-1 text-caption"><Maximize2 className="h-3 w-3" /> Full screen</span></button>
        <div className="space-y-2 text-caption"><p>1. On a new or already-reset Android phone, tap the Welcome screen 6 times to open its QR scanner.</p><p>2. Scan this QR, connect Wi-Fi and finish Android setup.</p><p>3. Keep this form open. Available company, model, IMEI and serial details will appear here.</p><p>Use only a phone the customer has agreed to enroll. This button does not reset a phone.</p></div>
      </div>}
      <button type="button" className="btn-ghost mt-3" disabled={busy || disabled} onClick={() => void cancel()}>Cancel phone scan</button>
      {status === 'RECEIVED' && <p className="mt-2 text-caption">Cancelling releases this unassigned phone from setup. Starting phone management again requires Welcome-screen enrollment.</p>}
    </>}
    {full && session && <div role="dialog" aria-modal="true" aria-label="Phone scan QR" className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-4 bg-white p-6"><button type="button" onClick={() => setFull(false)} className="absolute right-5 top-5 btn-secondary" aria-label="Close phone scan QR"><X /></button><img src={session.qrImageDataUrl} alt="Welcome-screen enrollment QR full size" className="aspect-square w-[min(85vw,75vh)]" /><p className="text-center font-bold">Scan from the new phone’s Android Welcome screen.</p></div>}
  </div>;
}
