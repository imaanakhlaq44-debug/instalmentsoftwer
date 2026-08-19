import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { shrinkImageForUpload } from '../../utils/image.js';
import { Send, Upload, CheckCircle2, Clock } from 'lucide-react';

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/**
 * "I have paid" — the customer's side of the counter.
 *
 * Before this, a transfer made at ten at night could not enter the system until
 * somebody opened the shop, and the handset stayed locked in the meantime. Now
 * the customer reports it and the shop verifies from wherever they are.
 *
 * The wording is deliberate about what this does and does not do. It does not
 * credit anybody's account; it tells the shop to look. Promising an unlock here
 * would be the same dishonesty the device lock is built to avoid.
 */
export const SubmitPaymentCard: React.FC<{ onSubmitted: () => void }> = ({ onSubmitted }) => {
  const { user, showToast } = useAuth();

  const [plans, setPlans] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState('JAZZCASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user?.customerId) return;
    try {
      const detail = await ApiService.getCustomer(user.customerId);
      const open = (detail.plans ?? []).filter((p: any) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
      setPlans(open);
      if (open.length === 1) setPlanId(open[0].id);

      const payments = await ApiService.getPayments({ status: 'PENDING', limit: 20 });
      setPending((payments.data ?? []).filter((p: any) => p.source === 'CUSTOMER'));
    } catch {
      // The card simply does not render its form if this fails; the page's own
      // error handling covers the session-level problems worth reporting.
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.customerId]);

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

  const submit = async () => {
    if (!planId || !amount || reference.trim().length < 4) return;
    try {
      setSubmitting(true);
      await ApiService.submitPayment({
        planId,
        amount: Number(amount),
        paymentMethod: method,
        referenceNumber: reference.trim(),
        notes: notes.trim() || undefined,
        proofImage: proof ?? undefined,
      });
      showToast('Sent to the shop. They will confirm it against their account.', 'success');
      setAmount('');
      setReference('');
      setNotes('');
      setProof(null);
      load();
      onSubmitted();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (plans.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Send className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Already paid? Tell the shop
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          If you have transferred your installment, enter the transaction ID here. The shop will check it against
          their account. Your phone unlocks once they confirm it — this form does not unlock it by itself.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs"
            >
              <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
              <span className="text-amber-900">
                {money(payment.amount)} · {payment.referenceNumber} — waiting for the shop to check
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {plans.length > 1 && (
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
              Which phone
            </label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {money(plan.remainingBalance)} remaining
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Amount sent
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="7500"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Sent by
          </label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
          >
            <option value="JAZZCASH">JazzCash</option>
            <option value="EASYPAISA">Easypaisa</option>
            <option value="RAAST">Raast</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="ONLINE">Other online</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Transaction ID (TID)
          </label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="The reference number from your transfer receipt"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Note for the shop (optional)
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-50">
          <Upload className="w-4 h-4" aria-hidden="true" />
          {preparingImage ? 'Preparing…' : proof ? 'Screenshot attached' : 'Attach screenshot'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => attachProof(e.target.files?.[0])}
          />
        </label>

        {proof && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Ready to send
          </span>
        )}

        <button
          onClick={submit}
          disabled={submitting || preparingImage || !planId || !amount || reference.trim().length < 4}
          className="ml-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold"
        >
          {submitting ? 'Sending…' : 'Send to the shop'}
        </button>
      </div>
    </div>
  );
};
