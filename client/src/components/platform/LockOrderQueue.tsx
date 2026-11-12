import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Image as ImageIcon, KeyRound, MessageCircle, Phone, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';
import { Card, CardHeader, EmptyState, Rows, Skeleton } from '../ui/Card.js';
import { money, shortDate } from '../../utils/format.js';
import { LockOrder, ORDER_STATUS, methodLabel } from '../../utils/lockOrders.js';

/**
 * The super admin's side of a lock order.
 *
 * A shop has said "I sent Rs 24,000 by JazzCash, TID such-and-such". This is
 * where the platform owner looks in their own account for that transfer and
 * answers: approve, which gives the shop its locks, or reject, with a reason the
 * shop will read. Approval cannot be undone and cannot happen twice — the
 * server refuses a second one — so the button asks before it acts.
 */

const whatsappNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `92${digits.slice(1)}` : digits;
};

export const LockOrderQueue: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { showToast } = useAuth();

  const [orders, setOrders] = useState<LockOrder[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [viewingProof, setViewingProof] = useState<string | null>(null);

  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await ApiService.getLockOrders();
      setOrders(res.orders ?? []);
      setInstructions(res.paymentInstructions ?? '');
      setSavedInstructions(res.paymentInstructions ?? '');
    } catch (err: any) {
      showToast(err?.message || 'Could not load the lock orders', 'error');
      setOrders([]);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  const approve = async (order: LockOrder) => {
    const ok = window.confirm(
      `Did ${money(order.amountPaid)} from ${order.dealerName} reach your account?\n` +
        `${methodLabel(order.paymentMethod)} · TID ${order.transactionId}\n\n` +
        `This gives them ${order.size} locks now and cannot be undone.`
    );
    if (!ok) return;
    try {
      setWorking(order.id);
      const res = await ApiService.approveLockOrder(order.id);
      showToast(res.message || `${order.size} locks given to ${order.dealerName}`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not approve the order', 'error');
    } finally {
      setWorking(null);
      await refresh();
    }
  };

  const reject = async (order: LockOrder) => {
    if (reason.trim().length < 5) {
      showToast('Write the reason, so the shop knows what to fix.', 'error');
      return;
    }
    try {
      setWorking(order.id);
      await ApiService.rejectLockOrder(order.id, reason.trim());
      showToast('Order rejected.', 'success');
      setRejecting(null);
      setReason('');
    } catch (err: any) {
      showToast(err?.message || 'Could not reject the order', 'error');
    } finally {
      setWorking(null);
      await refresh();
    }
  };

  const showProof = async (order: LockOrder) => {
    try {
      setViewingProof((await ApiService.getLockOrderProof(order.id)).proofImage);
    } catch (err: any) {
      showToast(err?.message || 'Could not open the screenshot', 'error');
    }
  };

  const saveInstructions = async () => {
    try {
      setSavingInstructions(true);
      const res = await ApiService.saveLockPaymentInstructions(instructions);
      setInstructions(res.paymentInstructions ?? '');
      setSavedInstructions(res.paymentInstructions ?? '');
      showToast('Payment instructions saved.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not save the payment instructions', 'error');
    } finally {
      setSavingInstructions(false);
    }
  };

  const pending = (orders ?? []).filter((o) => o.status === 'PENDING').reverse(); // oldest first: first paid, first served
  const decided = (orders ?? []).filter((o) => o.status !== 'PENDING').slice(0, 20);

  return (
    <>
      <Card>
        <CardHeader title="Payments to check" hint="Shops that say they have paid. Find the transfer in your account, then decide." />
        <div className="mt-4">
          {orders === null ? (
            <Skeleton className="h-20" />
          ) : pending.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
              title="No payments to check"
              body="When a shop sends its transaction ID, the order appears here."
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((o) => {
                const mismatch = o.amountPaid !== o.totalPrice;
                return (
                  <li key={o.id} className="rounded-md border-2 border-ink-900 bg-sun-100 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-lede font-extrabold text-ink-900" data-i18n-skip>{o.dealerName}</p>
                        <p className="text-caption text-ink-700">
                          <span data-i18n-skip>{o.ownerName} · {o.dealerCity}</span> · {shortDate(o.createdAt)}
                        </p>
                        <p className="mt-1 text-body text-ink-900">
                          Ordered: <b>{`${o.size} locks`}</b> · <b>{money(o.totalPrice)}</b>
                        </p>
                        <p className="mt-1 text-body text-ink-900">
                          Shop says it paid: <b>{money(o.amountPaid)}</b> · <b>{methodLabel(o.paymentMethod)}</b> ·{' '}
                          <span className="font-mono font-bold" data-i18n-skip>TID {o.transactionId}</span>
                        </p>
                        {mismatch && (
                          <p className="mt-1 flex items-center gap-1.5 text-caption font-bold text-critical-700">
                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                            The amount sent does not match the price.
                          </p>
                        )}
                        {o.note && <p className="mt-1 text-caption text-ink-700" data-i18n-skip>“{o.note}”</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {o.hasProof && (
                          <button type="button" className="btn-secondary py-1.5 text-caption" onClick={() => showProof(o)}>
                            <ImageIcon className="h-4 w-4" aria-hidden="true" /> Screenshot
                          </button>
                        )}
                        <a className="btn-secondary py-1.5 text-caption" href={`https://wa.me/${whatsappNumber(o.dealerPhone)}`} target="_blank" rel="noopener">
                          <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                        </a>
                        <a className="btn-secondary py-1.5 text-caption" href={`tel:${o.dealerPhone}`}>
                          <Phone className="h-4 w-4" aria-hidden="true" /> Call
                        </a>
                        <button
                          type="button"
                          className="btn-secondary py-1.5 text-caption"
                          disabled={working !== null}
                          onClick={() => {
                            setRejecting(rejecting === o.id ? null : o.id);
                            setReason('');
                          }}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
                        </button>
                        <button type="button" className="btn-primary py-1.5 text-caption" disabled={working !== null} onClick={() => approve(o)}>
                          <KeyRound className="h-4 w-4" aria-hidden="true" />
                          {working === o.id ? 'Working…' : `Payment received: give ${o.size} locks`}
                        </button>
                      </div>
                    </div>

                    {rejecting === o.id && (
                      <div className="mt-3 border-t-2 border-dashed border-ink-900 pt-3">
                        <label htmlFor={`reason-${o.id}`} className="field-label">Why is it rejected? (the shop will see this)</label>
                        <textarea
                          id={`reason-${o.id}`}
                          className="input block min-h-[4.5rem]"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={500}
                          placeholder="e.g. No payment with this transaction ID reached our account."
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button type="button" className="btn-ghost px-3 py-1.5 text-caption" onClick={() => setRejecting(null)}>
                            Cancel
                          </button>
                          <button type="button" className="btn-primary py-1.5 text-caption" disabled={working !== null} onClick={() => reject(o)}>
                            Reject order
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Where shops pay" hint="Shown to every shop on its Buy locks page" />
        <div className="mt-4">
          <label htmlFor="pay-instructions" className="field-label">Your account details</label>
          <textarea
            id="pay-instructions"
            className="input block min-h-[7rem]"
            // Not editable until the saved text has arrived, or it would be
            // overwritten under the owner's cursor.
            disabled={orders === null}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={1000}
            placeholder={'JazzCash: 03xx-xxxxxxx (account name)\nBank: bank name, account title, IBAN'}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-ink-500">
              {savedInstructions ? 'Shops see exactly what is written here.' : 'Nothing is saved yet. Shops are told to ask on WhatsApp.'}
            </p>
            <button
              type="button"
              className="btn-primary py-1.5 text-caption"
              disabled={savingInstructions || instructions.trim() === savedInstructions.trim()}
              onClick={saveInstructions}
            >
              {savingInstructions ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader title="Decided orders" hint="The last 20 approved, rejected or cancelled" />
          <div className="mt-4">
            <Rows>
              {decided.map((o) => (
                <li key={o.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-body font-bold text-ink-900">
                      <span data-i18n-skip>{o.dealerName}</span> · <span className="tabular">{`${o.size} locks`}</span> ·{' '}
                      <span className="tabular">{money(o.totalPrice)}</span>
                    </p>
                    <p className="text-caption text-ink-500">
                      {shortDate(o.createdAt)} · {methodLabel(o.paymentMethod)} · <span data-i18n-skip>TID {o.transactionId}</span>
                      {o.reviewedByName && <span data-i18n-skip> · {o.reviewedByName}</span>}
                    </p>
                    {o.rejectionReason && (
                      <p className="text-caption text-critical-700">
                        Reason: <span data-i18n-skip>{o.rejectionReason}</span>
                      </p>
                    )}
                  </div>
                  <span className={`status-pill shrink-0 ${ORDER_STATUS[o.status].pill}`}>{ORDER_STATUS[o.status].label}</span>
                </li>
              ))}
            </Rows>
          </div>
        </Card>
      )}

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
    </>
  );
};
