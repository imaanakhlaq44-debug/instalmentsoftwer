import { useEffect, useRef, useState } from 'react';
import { IdCard, X } from 'lucide-react';

/** The object the ALMAS SDM shop app puts on its own pages. Absent in a browser. */
interface CnicBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** What the shop app read off the front of the card. */
export interface CnicScan {
  cnic: string | null;
  name: string | null;
  fatherName: string | null;
  dateOfBirth: string | null;
  dateOfExpiry: string | null;
  lifetime: boolean;
}

type Failure = 'cancelled' | 'unreadable' | 'permission' | 'camera' | 'busy';
export type ScanReply = { ok: true; card: CnicScan } | { ok: false; reason: Failure };

export function cnicBridge(): CnicBridge | null {
  const bridge = (globalThis as { AlmasCnic?: CnicBridge }).AlmasCnic;
  return bridge && typeof bridge.postMessage === 'function' ? bridge : null;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The app's answer, checked: anything malformed counts as an unreadable card. */
export function parseScanReply(data: unknown): ScanReply {
  let value: unknown = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }
  const v = (value ?? {}) as Record<string, unknown>;
  if (v.ok !== true) {
    const reason = v.reason as Failure;
    return {
      ok: false,
      reason: ['cancelled', 'unreadable', 'permission', 'camera', 'busy'].includes(reason) ? reason : 'unreadable',
    };
  }
  const cnic = text(v.cnic);
  return {
    ok: true,
    card: {
      cnic: cnic && /^\d{5}-\d{7}-\d$/.test(cnic) ? cnic : null,
      name: text(v.name),
      fatherName: text(v.fatherName),
      dateOfBirth: text(v.dateOfBirth),
      dateOfExpiry: text(v.dateOfExpiry),
      lifetime: v.lifetime === true,
    },
  };
}

/** 2030-03-15 → 15.03.2030, the way the card prints it. */
const cardDate = (iso: string) => iso.split('-').reverse().join('.');

/** True when the card's expiry date is before today. */
export function isExpired(card: CnicScan, today = new Date()): boolean {
  if (card.lifetime || !card.dateOfExpiry) return false;
  const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return card.dateOfExpiry < todayIso;
}

type Status = 'idle' | 'waiting' | 'done' | Failure;

/**
 * "Scan CNIC card" above the CNIC box. Shown only inside the ALMAS SDM shop app,
 * which photographs the front of the card and reads it on the phone. (The QR on
 * the back is NADRA's own signed data; no one else can read it.)
 */
export function CnicScanButton({ onScan }: { onScan: (card: CnicScan) => void }) {
  const [bridge] = useState(cnicBridge);
  const [status, setStatus] = useState<Status>('idle');
  const [card, setCard] = useState<CnicScan | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!bridge) return;
    bridge.onmessage = (event) => {
      const reply = parseScanReply(event.data);
      if (reply.ok) {
        setCard(reply.card);
        setStatus('done');
        onScanRef.current(reply.card);
      } else {
        setStatus(reply.reason === 'cancelled' ? 'idle' : reply.reason);
      }
    };
    return () => {
      bridge.onmessage = null;
    };
  }, [bridge]);

  if (!bridge) return null;

  const start = () => {
    setCard(null);
    setStatus('waiting');
    bridge.postMessage('scan');
  };

  const filled = card ? [card.cnic && 'CNIC number', card.name && 'name'].filter(Boolean) : [];

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={start}
        className="btn-secondary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
      >
        <IdCard className="h-5 w-5" aria-hidden="true" />
        <span>Scan CNIC card</span>
      </button>
      <p className="mt-1.5 text-caption text-ink-400">
        Take a photo of the front of the card, flat and in good light. The number and name fill in by themselves.
      </p>

      {status !== 'idle' && (
        <div role="status" className="surface mt-2 flex items-start justify-between gap-2 rounded-xl border-2 border-ink p-3">
          <div className="min-w-0 text-sm font-bold">
            {status === 'waiting' && <p>Reading the card…</p>}
            {status === 'done' && card && (
              <>
                {filled.length === 2 && <p>Filled from the card. Check them before saving.</p>}
                {filled.length === 1 && card.cnic && (
                  <p>Only the CNIC number could be read. Please type the name.</p>
                )}
                {filled.length === 1 && !card.cnic && (
                  <p>Only the name could be read. Please type the CNIC number.</p>
                )}
                {card.fatherName && (
                  <p className="mt-1 font-semibold text-ink-700">
                    <span>Father / husband:</span> <span data-i18n-skip>{card.fatherName}</span>
                  </p>
                )}
                {isExpired(card) && card.dateOfExpiry && (
                  <p className="mt-2 rounded-md border-2 border-caution-200 bg-caution-50 p-2 text-caution-700">
                    <span>This CNIC has expired. Expiry on the card:</span>{' '}
                    <span data-i18n-skip>{cardDate(card.dateOfExpiry)}</span>
                  </p>
                )}
              </>
            )}
            {status === 'unreadable' && (
              <p>Could not read the card. Put the front side flat, in good light, fill the photo with it, and try again.</p>
            )}
            {status === 'permission' && <p>Camera permission was not allowed. Please type the CNIC.</p>}
            {status === 'camera' && <p>Could not open the camera. Please type the CNIC.</p>}
            {status === 'busy' && <p>A card scan is already open.</p>}
          </div>
          <button
            type="button"
            onClick={() => setStatus('idle')}
            className="btn-secondary shrink-0 inline-flex items-center gap-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
