import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { Inbox, CheckCircle2, ExternalLink } from 'lucide-react';

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/**
 * What customers say they have paid, waiting for somebody to check.
 *
 * The wording throughout is "claims" and "check against your account", not
 * "received". Nothing here has been reconciled — a transaction ID typed into a
 * form is a lead, and verifying it is a person looking at their JazzCash or
 * bank statement and deciding. Only then does the money move, the installment
 * settle and the handset unlock.
 */
export const PendingSubmissions: React.FC<{ onVerified: () => void }> = ({ onVerified }) => {
  const { selectedDealerId, showToast, isDealerAdmin } = useAuth();

  const [submissions, setSubmissions] = useState<any[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [viewingProof, setViewingProof] = useState<string | null>(null);

  const load = async () => {
    try {
      setSubmissions((await ApiService.getPendingSubmissions()).data ?? []);
    } catch {
      // A staff member who cannot read the queue still gets the payments list;
      // failing loudly here would be noise on every page load.
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId]);

  const verify = async (payment: any) => {
    try {
      setWorking(payment.id);
      const res = await ApiService.verifyPayment(payment.id);
      showToast(res.message || 'Payment verified and applied.', 'success');
      load();
      onVerified();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setWorking(null);
    }
  };

  if (submissions.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl border border-amber-200 shadow-card overflow-hidden">
      <div className="p-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
        <Inbox className="w-4 h-4 text-amber-600" aria-hidden="true" />
        <div>
          <h2 className="text-xs font-extrabold text-amber-900">
            {submissions.length} payment{submissions.length === 1 ? '' : 's'} customers say they have sent
          </h2>
          <p className="text-[11px] text-amber-800 mt-0.5">
            Check each transaction ID against your own account before confirming. Confirming applies the money and
            unlocks the handset.
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {submissions.map((payment) => (
          <div key={payment.id} className="p-4 flex items-start gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900">{money(payment.amount)}</span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {payment.paymentMethod}
                </span>
              </div>
              <p className="text-xs text-slate-700 mt-1">
                {payment.customerName}
                {payment.customerPhone ? ` · ${payment.customerPhone}` : ''}
              </p>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">TID {payment.referenceNumber}</p>
              {payment.notes && <p className="text-[11px] text-slate-500 mt-1">“{payment.notes}”</p>}
              <p className="text-[10px] text-slate-400 mt-1">
                Reported {new Date(payment.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {payment.proofImage && (
                <button
                  onClick={() => setViewingProof(payment.proofImage)}
                  className="px-3 py-2 text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Screenshot
                </button>
              )}

              {isDealerAdmin && (
                <button
                  onClick={() => verify(payment)}
                  disabled={working === payment.id}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  {working === payment.id ? 'Applying…' : 'Confirm received'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewingProof && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"
          onClick={() => setViewingProof(null)}
        >
          <img
            src={viewingProof}
            alt="Customer's transfer screenshot"
            className="max-h-[90vh] max-w-full rounded-2xl"
          />
        </div>
      )}
    </div>
  );
};
