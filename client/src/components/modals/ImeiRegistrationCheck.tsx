import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { ApiService, type ImeiStatus } from '../../services/api.js';

type Registered = Extract<ImeiStatus, { sameShop: true }>;

const rupees = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/**
 * Tells the counter, as soon as a full IMEI is typed or scanned, that the phone
 * is already registered — before the whole sale is filled in — and lets the
 * shop owner close the old registration there and then.
 *
 * This is the resale case: the shop took a phone back and is selling it to
 * someone else. Closing releases the phone, stops the old plan and frees the
 * IMEI; nothing in the old customer's history is deleted.
 *
 * `recheck` is bumped by the form when the server refuses a sale for this
 * reason, so the panel appears even if the check had not run yet.
 */
export function ImeiRegistrationCheck({ imei, recheck = 0 }: { imei: string; recheck?: number }) {
  const digits = imei.replace(/\D/g, '');
  const [status, setStatus] = useState<ImeiStatus | null>(null);
  const [closing, setClosing] = useState<Registered | null>(null);
  const [freed, setFreed] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setStatus(null);
    if (digits.length !== 15) return;
    let live = true;
    const timer = setTimeout(() => {
      ApiService.getImeiStatus(digits)
        .then((s) => { if (live) setStatus(s); })
        // The server still refuses a duplicate at save time; a failed look-up
        // only means the early warning is not shown.
        .catch(() => undefined);
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [digits, recheck, refresh]);

  if (freed && freed === digits && status && !status.registered) {
    return (
      <div role="status" className="mt-2 flex items-start gap-2 rounded-md border-2 border-ink-900 bg-positive-50 p-3 text-caption">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive-700" aria-hidden="true" />
        <span>Old registration closed. You can register this phone for the new customer now.</span>
      </div>
    );
  }
  if (!status || !status.registered) return null;

  if (!status.sameShop) {
    return (
      <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border-2 border-critical-600 bg-critical-50 p-3 text-caption">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical-700" aria-hidden="true" />
        <span>
          This IMEI is registered with another shop. That shop has to release it first, or contact Almas SDM support.
        </span>
      </div>
    );
  }

  const { device } = status;
  const owed = device.plan && !['COMPLETED', 'CANCELLED'].includes(device.plan.status)
    ? device.plan.remainingBalance + device.plan.outstandingLateFees
    : 0;

  return (
    <div role="alert" className="mt-2 space-y-2 rounded-md border-2 border-caution-600 bg-caution-50 p-3 text-caption">
      <p className="flex items-start gap-2 font-extrabold text-ink-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical-700" aria-hidden="true" />
        <span>This phone is already registered in your shop.</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-6">
        <dt className="text-ink-500">Customer</dt>
        <dd className="font-bold" data-i18n-skip>{device.customerName ?? '—'}</dd>
        <dt className="text-ink-500">Phone</dt>
        <dd className="font-bold" data-i18n-skip>{device.brand} {device.model}</dd>
        <dt className="text-ink-500">Status</dt>
        <dd className="font-bold">{device.status}</dd>
        {owed > 0 && (
          <>
            <dt className="text-ink-500">Still owed</dt>
            <dd className="font-bold text-critical-700" data-i18n-skip>{rupees(owed)}</dd>
          </>
        )}
      </dl>
      {status.canClose ? (
        <div className="pl-6">
          <p className="mb-2 text-ink-700">If you took this phone back and are selling it again, close the old registration first.</p>
          <button type="button" className="btn-secondary !py-1.5" onClick={() => setClosing(status)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Close old registration
          </button>
        </div>
      ) : (
        <p className="pl-6 text-ink-700">Ask the shop owner to close the old registration before registering it again.</p>
      )}
      {closing && (
        <CloseRegistrationDialog
          status={closing}
          owed={owed}
          onClose={() => setClosing(null)}
          onClosed={() => { setClosing(null); setFreed(digits); setRefresh((n) => n + 1); }}
        />
      )}
    </div>
  );
}

const REASONS = ['Phone taken back from the customer', 'Customer returned the phone', 'Sale cancelled'];

function CloseRegistrationDialog({
  status,
  owed,
  onClose,
  onClosed,
}: {
  status: Registered;
  owed: number;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [last4, setLast4] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const ready = reason.trim().length >= 5 && /^\d{4}$/.test(last4);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>('#close-reg-last4')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus?.(); };
  }, [busy, onClose]);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await ApiService.closeRegistration(status.device.id, { reason: reason.trim(), confirmImeiLast4: last4 });
      onClosed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the registration.');
      setBusy(false);
    }
  };

  // A portal, and plain buttons rather than a <form>: this sits inside the
  // sale form, and a submit here must never submit the sale.
  return createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-ink-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="close-reg-title">
      <div ref={panel} className="surface w-full max-w-lg space-y-4 p-5 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 id="close-reg-title" className="flex items-center gap-2 text-title font-black">
            <RotateCcw className="h-6 w-6" aria-hidden="true" />
            Close old registration
          </h2>
          <button type="button" className="btn-ghost p-2" aria-label="Close" disabled={busy} onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <p className="font-bold" data-i18n-skip>
          {status.device.brand} {status.device.model} · {status.device.customerName ?? '—'}
        </p>

        <ul className="list-disc space-y-1 pl-5 text-body">
          <li>The phone is released: at its next internet connection the app removes its lock and restrictions.</li>
          <li>The old installment plan is cancelled. No more reminders, late fees or locks for the old customer.</li>
          <li>The old customer, payments and agreement stay in the records. Nothing is deleted.</li>
        </ul>

        {owed > 0 && (
          <p role="note" className="rounded-md border-2 border-critical-600 bg-critical-50 p-3 text-body">
            <span className="font-extrabold">This plan still has money owed: </span>
            <span className="font-extrabold" data-i18n-skip>{rupees(owed)}</span>
            <span className="mt-1 block">It stays recorded in the audit trail, but the plan stops collecting it.</span>
          </p>
        )}

        <div>
          <label htmlFor="close-reg-reason" className="field-label">Reason</label>
          <div className="mb-2 flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`rounded-md border-2 border-ink-900 px-2.5 py-1 text-caption font-bold ${reason === r ? 'bg-sun-200' : 'bg-white'}`}
                onClick={() => setReason(r)}
                disabled={busy}
              >
                {r}
              </button>
            ))}
          </div>
          <input id="close-reg-reason" className="input" value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div>
          <label htmlFor="close-reg-last4" className="field-label">Type the last 4 digits of the IMEI to confirm</label>
          <input
            id="close-reg-last4"
            className="input w-32 font-mono tracking-widest"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={last4}
            disabled={busy}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            data-i18n-skip
          />
        </div>

        <p className="text-caption text-ink-500">
          If the old app is still on the phone, keep it switched on with internet until it lets go, then factory reset it and scan the new sale's QR.
        </p>

        {error && <p role="alert" className="text-body font-semibold text-critical-700">{error}</p>}

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? 'Closing…' : 'Close registration'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
