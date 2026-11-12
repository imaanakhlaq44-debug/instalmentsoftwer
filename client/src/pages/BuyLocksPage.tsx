import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Image as ImageIcon, MessageCircle, ShoppingCart, Upload, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { Card, CardHeader, EmptyState, Rows, Skeleton } from '../components/ui/Card.js';
import { shortDate } from '../utils/format.js';
import { shrinkImageForUpload } from '../utils/image.js';
import { MAX_PACK_SIZE, PACK_PRESETS, money, priceForPack } from '../utils/packPricing.js';
import {
  LockOrder, ORDER_PAYMENT_METHODS, ORDER_STATUS, methodLabel, validateLockOrder,
} from '../utils/lockOrders.js';

/**
 * A shop buys locks.
 *
 * Three steps on one page, in the order the owner does them: pick how many,
 * send the money to the account shown, then tell us the transaction ID. The
 * page is careful about what sending the form does: it asks the platform to
 * check a payment. Locks arrive when that check passes, not when the button is
 * pressed, and the order list underneath shows where each one stands.
 */

const WHATSAPP_NUMBER = '923211144477';

const Step: React.FC<{ n: string; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <Card>
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink-900 bg-sun-400 font-black text-ink-900">
        {n}
      </span>
      <h2 className="text-title font-extrabold text-ink-900">{title}</h2>
    </div>
    <div className="mt-4">{children}</div>
  </Card>
);

export const BuyLocksPage: React.FC = () => {
  const { dealer, showToast } = useAuth();

  const [orders, setOrders] = useState<LockOrder[] | null>(null);
  const [instructions, setInstructions] = useState('');
  const [maxPending, setMaxPending] = useState(3);

  // A shop that picked a pack at sign-up starts on that pack.
  const [size, setSize] = useState<number>((dealer as { requestedPackSize?: number } | null)?.requestedPackSize || 30);
  const [method, setMethod] = useState<string>('JAZZCASH');
  const [transactionId, setTransactionId] = useState('');
  const [amountPaid, setAmountPaid] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [viewingProof, setViewingProof] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiService.getLockOrders();
      setOrders(res.orders ?? []);
      setInstructions(res.paymentInstructions ?? '');
      setMaxPending(res.maxPendingOrders ?? 3);
    } catch (err: any) {
      showToast(err?.message || 'Could not load your orders', 'error');
      setOrders([]);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const pack = priceForPack(size);
  const pendingCount = (orders ?? []).filter((o) => o.status === 'PENDING').length;
  const atLimit = pendingCount >= maxPending;

  const whatsappText = encodeURIComponent(
    `Salam, "${dealer?.name ?? ''}" ke liye ${pack?.size ?? ''} locks chahiye: ${money(pack?.totalPrice ?? 0)}. ` +
      'Payment ki detail bhej dein.'
  );

  const attachProof = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPreparingImage(true);
      setProof(await shrinkImageForUpload(file));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setPreparingImage(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = validateLockOrder({ size, paymentMethod: method, transactionId, amountPaid });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      setSubmitting(true);
      const res = await ApiService.submitLockOrder({
        size,
        paymentMethod: method,
        transactionId: transactionId.trim(),
        amountPaid: Number(amountPaid),
        proofImage: proof ?? undefined,
        note: note.trim() || undefined,
      });
      showToast(res.message || 'Order received.', 'success');
      setTransactionId('');
      setAmountPaid('');
      setNote('');
      setProof(null);
      await load();
    } catch (err: any) {
      const detail = err?.details?.map((d: { message: string }) => d.message).filter(Boolean).join(' ');
      setError(detail || err?.message || 'Could not send the order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (order: LockOrder) => {
    if (!window.confirm('Cancel this order? Do this only if the details you sent were wrong.')) return;
    try {
      setWorking(order.id);
      await ApiService.cancelLockOrder(order.id);
      showToast('Order cancelled.', 'success');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Could not cancel the order', 'error');
    } finally {
      setWorking(null);
    }
  };

  const showProof = async (order: LockOrder) => {
    try {
      setViewingProof((await ApiService.getLockOrderProof(order.id)).proofImage);
    } catch (err: any) {
      showToast(err?.message || 'Could not open the screenshot', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Licensing</p>
        <h1 className="mt-1 text-display text-ink-900">Buy locks</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-500">
          One lock holds one phone. Choose how many you need, pay, and send us the transaction ID. Your locks are added
          as soon as we confirm the payment.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <Step n="1" title="How many locks?">
          <div className="flex flex-wrap gap-2">
            {PACK_PRESETS.map((n) => {
              const selected = n === size;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSize(n)}
                  aria-pressed={selected}
                  className={`rounded-md border-2 border-ink-900 px-3.5 py-1.5 text-body font-extrabold transition ${
                    selected ? 'bg-sun-400 shadow-[3px_3px_0_#0F1419]' : 'bg-white hover:bg-sun-100'
                  }`}
                >
                  {n}
                </button>
              );
            })}
            <input
              type="number"
              min={1}
              max={MAX_PACK_SIZE}
              inputMode="numeric"
              className="input w-24 py-1.5"
              value={Number.isFinite(size) ? size : ''}
              onChange={(e) => setSize(e.target.value === '' ? NaN : Number(e.target.value))}
              disabled={submitting}
              aria-label="Number of locks"
            />
          </div>
          <div className="mt-3 rounded-md border-2 border-ink-900 bg-sun-100 px-3.5 py-2.5">
            {pack ? (
              <p className="text-body text-ink-900">
                <b>{`${pack.size} locks`}</b>
                {` · ${money(pack.unitPrice)} per phone · `}
                <b>{`${money(pack.totalPrice)} total`}</b>
              </p>
            ) : (
              <p className="text-body text-critical-700">{`Choose between 1 and ${MAX_PACK_SIZE} locks.`}</p>
            )}
            <p className="mt-1 text-caption text-ink-700">
              1–29: Rs 1,000 · 30–49: Rs 800 · 50–99: Rs 700 · 100+: Rs 600 per phone
            </p>
          </div>
        </Step>

        <Step n="2" title="Send the payment">
          {pack && (
            <p className="text-body text-ink-900">
              Amount to send: <b className="tabular">{money(pack.totalPrice)}</b>
            </p>
          )}
          {orders === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : instructions ? (
            <div className="mt-3 rounded-md border-2 border-ink-900 bg-paper-50 p-4">
              <p className="eyebrow">Pay to</p>
              {/* The account details exactly as the platform wrote them. */}
              <p className="mt-1.5 whitespace-pre-line break-words text-body font-semibold text-ink-900" data-i18n-skip>
                {instructions}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-body text-ink-700">Ask us on WhatsApp for the account to pay into.</p>
          )}
          <a
            className="btn-secondary mt-3 py-1.5 text-caption"
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappText}`}
            target="_blank"
            rel="noopener"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Ask on WhatsApp
          </a>
        </Step>

        <Step n="3" title="Tell us you have paid">
          {error && (
            <div role="alert" className="mb-4 rounded-md border-2 border-critical-600 bg-critical-50 px-3.5 py-2.5 text-body text-critical-700">
              {error}
            </div>
          )}
          {atLimit && (
            <p className="mb-4 rounded-md border-2 border-ink-900 bg-sun-100 px-3.5 py-2.5 text-body text-ink-900">
              Your earlier orders are still being checked. Please wait for those before sending another.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="o-method" className="field-label">Paid by</label>
              <select id="o-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)} disabled={submitting}>
                {ORDER_PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="o-amount" className="field-label">Amount sent (Rs)</label>
              <input
                id="o-amount"
                type="number"
                min={1}
                inputMode="numeric"
                className="input"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={pack ? String(pack.totalPrice) : ''}
                disabled={submitting}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="o-tid" className="field-label">Transaction ID (TID)</label>
              <input
                id="o-tid"
                className="input"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="The reference number from your transfer receipt"
                maxLength={60}
                autoComplete="off"
                disabled={submitting}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="o-note" className="field-label">Note (optional)</label>
              <input id="o-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={submitting} />
            </div>
          </div>

          {pack && amountPaid !== '' && amountPaid !== pack.totalPrice && (
            <p className="mt-3 text-caption font-semibold text-caution-700">
              The amount you sent is different from the price of this pack. Please check before sending.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="btn-secondary cursor-pointer py-1.5 text-caption">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {preparingImage ? 'Preparing…' : proof ? 'Screenshot attached' : 'Attach screenshot (optional)'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => attachProof(e.target.files?.[0])} />
            </label>
            <button type="submit" disabled={submitting || preparingImage || atLimit || !pack} className="btn-primary ml-auto py-2">
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              {submitting ? 'Sending…' : 'Send order'}
            </button>
          </div>
          <p className="mt-3 text-caption text-ink-500">
            Sending this does not add locks by itself. We check the payment first, usually the same day.
          </p>
        </Step>
      </form>

      <Card>
        <CardHeader title="Your orders" hint="Newest first" />
        <div className="mt-4">
          {orders === null ? (
            <Skeleton className="h-20" />
          ) : orders.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="h-6 w-6" aria-hidden="true" />}
              title="No orders yet"
              body="When you send an order it appears here, with its status."
            />
          ) : (
            <Rows>
              {orders.map((o) => {
                const status = ORDER_STATUS[o.status];
                return (
                  <li key={o.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-body font-bold text-ink-900">
                        <span className="tabular">{`${o.size} locks`}</span>
                        <span className="tabular">{money(o.totalPrice)}</span>
                        <span className={`status-pill ${status.pill}`}>
                          {o.status === 'PENDING' && <Clock className="h-3 w-3" aria-hidden="true" />}
                          {o.status === 'APPROVED' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                          {o.status === 'REJECTED' && <XCircle className="h-3 w-3" aria-hidden="true" />}
                          {status.label}
                        </span>
                      </p>
                      <p className="mt-0.5 text-caption text-ink-500">
                        {shortDate(o.createdAt)} · {methodLabel(o.paymentMethod)} ·{' '}
                        <span data-i18n-skip>TID {o.transactionId}</span> · {money(o.amountPaid)}
                      </p>
                      {o.status === 'REJECTED' && o.rejectionReason && (
                        <p className="mt-1 text-caption font-semibold text-critical-700">
                          Reason: <span data-i18n-skip>{o.rejectionReason}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {o.hasProof && (
                        <button type="button" className="btn-ghost px-2 py-1 text-caption" onClick={() => showProof(o)}>
                          <ImageIcon className="h-4 w-4" aria-hidden="true" /> Screenshot
                        </button>
                      )}
                      {o.status === 'PENDING' && (
                        <button
                          type="button"
                          className="btn-secondary py-1 text-caption"
                          disabled={working !== null}
                          onClick={() => cancel(o)}
                        >
                          {working === o.id ? 'Cancelling…' : 'Cancel order'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </Rows>
          )}
        </div>
      </Card>

      {viewingProof && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4"
          onClick={() => setViewingProof(null)}
          role="dialog"
          aria-label="Payment screenshot"
        >
          <img src={viewingProof} alt="Payment screenshot" className="max-h-[90vh] max-w-full rounded-md border-2 border-ink-900" />
        </div>
      )}
    </div>
  );
};

export default BuyLocksPage;
