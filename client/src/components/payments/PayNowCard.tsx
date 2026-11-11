import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { postToGateway } from '../../utils/gatewayRedirect.js';
import { CreditCard, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/** What is still owed on a plan — the most a customer may pay online. */
const owedOn = (plan: any) =>
  Math.max(0, (plan.remainingBalance ?? 0) + (plan.outstandingLateFees ?? 0) - (plan.creditBalance ?? 0));

type ReturnNotice = { tone: 'paid' | 'failed' | 'review'; amount?: number; receiptNumber?: string };

/**
 * "Pay now" — the customer pays on the gateway's own page and the installment
 * is applied when the gateway confirms it, with nobody at the shop involved.
 *
 * It renders nothing unless the shop has a gateway configured, which leaves
 * "Already paid? Tell the shop" below it as the only way to pay — exactly as
 * before this existed.
 *
 * After the gateway sends the customer back, the result shown here is the one
 * the server recorded for that checkout. The `?gateway=` in the address only
 * says there is something to look up; it is never taken as proof of payment.
 */
export const PayNowCard: React.FC<{ onPaid: () => void }> = ({ onPaid }) => {
  const { user, showToast } = useAuth();

  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<ReturnNotice | null>(null);

  const loadPlans = async () => {
    if (!user?.customerId) return;
    const detail = await ApiService.getCustomer(user.customerId);
    const open = (detail.plans ?? []).filter(
      (p: any) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED' && owedOn(p) > 0
    );
    setPlans(open);
    const first = open[0];
    if (first) {
      setPlanId((current) => current || first.id);
      setAmount((current) => (current === '' ? Math.min(first.monthlyInstallment ?? owedOn(first), owedOn(first)) : current));
    }
  };

  useEffect(() => {
    if (!user?.customerId) return;
    (async () => {
      try {
        const options = await ApiService.getGatewayOptions();
        if (!options.enabled) return;
        setProviders(options.providers);
        await loadPlans();
      } catch {
        // No gateway, no card. The report-a-transfer form below still works.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.customerId]);

  // Back from the gateway: ask the server what actually happened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('gateway');
    if (!flag) return;
    const reference = params.get('ref');

    params.delete('gateway');
    params.delete('ref');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));

    if (!reference) {
      setNotice({ tone: 'failed' });
      return;
    }
    (async () => {
      try {
        const checkout = await ApiService.getGatewayCheckout(reference);
        if (checkout.status === 'PAID') {
          setNotice({ tone: 'paid', amount: checkout.amount, receiptNumber: checkout.receiptNumber });
          onPaid();
        } else if (checkout.status === 'REVIEW') {
          setNotice({ tone: 'review', amount: checkout.amount });
        } else {
          setNotice({ tone: 'failed' });
        }
      } catch {
        setNotice({ tone: 'failed' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = plans.find((p) => p.id === planId);
  const owed = plan ? owedOn(plan) : 0;
  const valid = Boolean(plan) && amount !== '' && Number.isInteger(amount) && amount > 0 && amount <= owed;

  const pay = async (providerId: string) => {
    if (!valid || !plan) return;
    try {
      setStarting(true);
      const checkout = await ApiService.createGatewayCheckout({ planId: plan.id, amount: Number(amount), provider: providerId });
      postToGateway(checkout.redirect);
      // The browser is leaving for the gateway's page; keep the button disabled.
    } catch (err: any) {
      showToast(err.message, 'error');
      setStarting(false);
    }
  };

  const banner = notice && (
    <div
      role="status"
      className={
        'flex items-start gap-2 p-3 rounded-2xl border text-xs ' +
        (notice.tone === 'paid'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : notice.tone === 'review'
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-rose-50 border-rose-200 text-rose-900')
      }
    >
      {notice.tone === 'paid' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
      {notice.tone === 'review' && <Clock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
      {notice.tone === 'failed' && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
      <div className="space-y-0.5">
        {notice.tone === 'paid' && (
          <>
            <p className="font-bold">Payment received. Thank you.</p>
            <p data-i18n-skip>
              {notice.amount !== undefined && money(notice.amount)}
              {notice.receiptNumber && ` · ${notice.receiptNumber}`}
            </p>
          </>
        )}
        {notice.tone === 'review' && (
          <p className="font-bold">
            Your payment reached the gateway but could not be added to your account automatically. The shop has been
            told and will sort it out. Please do not pay again.
          </p>
        )}
        {notice.tone === 'failed' && (
          <p className="font-bold">The payment was not completed. No money was added to your account.</p>
        )}
      </div>
    </div>
  );

  const showForm = providers.length > 0 && plans.length > 0;
  if (!showForm && !banner) return null;

  return (
    <>
    {banner}
    {showForm && (
    <div className="bg-white rounded-3xl border-2 border-ink-900 shadow-card p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Pay your installment online
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          You will pay on the payment company's own secure page. Your installment is marked paid as soon as they
          confirm it.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {plans.length > 1 && (
          <div className="sm:col-span-2">
            <label htmlFor="paynow-plan" className="text-micro uppercase font-bold text-slate-500 tracking-wider block mb-1">
              Which phone
            </label>
            <select
              id="paynow-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {money(owedOn(p))} remaining
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="paynow-amount" className="text-micro uppercase font-bold text-slate-500 tracking-wider block mb-1">
            Amount to pay
          </label>
          <input
            id="paynow-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={owed}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
          />
          <p className="text-micro text-slate-500 mt-1" data-i18n-skip>
            Max {money(owed)}
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => pay(provider.id)}
              disabled={starting || !valid}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold"
            >
              {starting ? 'Opening…' : `Pay now · ${provider.label}`}
            </button>
          ))}
        </div>
      </div>
    </div>
    )}
    </>
  );
};
