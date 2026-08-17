import React, { useEffect, useState } from 'react';
import { X, Printer, Loader2, AlertTriangle } from 'lucide-react';
import { ApiService, ApiError } from '../../services/api.js';

interface Props {
  paymentId: string;
  onClose: () => void;
}

const rs = (n: number) => `Rs. ${Math.round(n || 0).toLocaleString('en-PK')}`;

/**
 * Printable payment receipt.
 *
 * The customer previously walked out of the shop with nothing. The layout is
 * deliberately narrow and monochrome so it prints cleanly on both A4 and the
 * 80mm thermal rolls most of these counters use — see the `@media print` block
 * in index.css, which hides the rest of the dashboard.
 */
export const ReceiptModal: React.FC<Props> = ({ paymentId, onClose }) => {
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await ApiService.getReceipt(paymentId);
        if (!cancelled) setReceipt(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the receipt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto print:bg-white print:p-0 print:block"
      role="dialog"
      aria-modal="true"
      aria-label="Payment receipt"
    >
      <div className="bg-white rounded-2xl w-full max-w-sm my-8 shadow-2xl print:shadow-none print:rounded-none print:my-0 print:max-w-none">
        {/* Screen-only toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 print:hidden">
          <h2 className="text-sm font-bold text-slate-900">Payment Receipt</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={loading || Boolean(error)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
              aria-label="Close receipt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" aria-hidden="true" />
            <p className="text-xs text-slate-500">Loading receipt…</p>
          </div>
        ) : error ? (
          <div className="py-16 flex flex-col items-center gap-3 px-6 text-center">
            <AlertTriangle className="w-7 h-7 text-amber-500" aria-hidden="true" />
            <p className="text-xs text-slate-600">{error}</p>
          </div>
        ) : (
          <div id="printable-receipt" className="p-6 font-mono text-[11px] text-slate-900 leading-relaxed">
            {/* Shop header */}
            <div className="text-center border-b-2 border-dashed border-slate-300 pb-3 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide">{receipt.dealer?.name ?? 'EMI Shield'}</h3>
              {receipt.dealer?.address && <p className="text-[10px] mt-0.5">{receipt.dealer.address}</p>}
              {receipt.dealer?.phone && <p className="text-[10px]">Ph: {receipt.dealer.phone}</p>}
              {receipt.dealer?.code && <p className="text-[10px] mt-0.5">Dealer Code: {receipt.dealer.code}</p>}
            </div>

            {receipt.status === 'REVERSED' && (
              <div className="border-2 border-slate-900 text-center py-1.5 mb-3 font-bold uppercase tracking-widest">
                Reversed — not valid
              </div>
            )}

            <div className="text-center mb-3">
              <p className="font-bold uppercase tracking-wide">Payment Receipt</p>
              <p className="text-[10px]">No. {receipt.receiptNumber}</p>
              <p className="text-[10px]">
                {new Date(receipt.issuedAt).toLocaleString('en-PK', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>

            <div className="border-t border-dashed border-slate-300 pt-2 mb-2 space-y-0.5">
              <Row label="Customer" value={receipt.customer?.name ?? '—'} />
              <Row label="Phone" value={receipt.customer?.phone ?? '—'} />
              {receipt.device && (
                <Row label="Device" value={`${receipt.device.brand} ${receipt.device.model}`} />
              )}
            </div>

            <div className="border-t border-dashed border-slate-300 pt-2 mb-2 space-y-0.5">
              <Row label="Method" value={receipt.payment.method} />
              <Row label="Reference" value={receipt.payment.reference} />
              {receipt.payment.lateFeePortion > 0 && (
                <>
                  <Row label="Towards principal" value={rs(receipt.payment.principalPortion)} />
                  <Row label="Towards late fee" value={rs(receipt.payment.lateFeePortion)} />
                </>
              )}
            </div>

            <div className="border-t-2 border-slate-900 border-b-2 py-2 my-2 flex justify-between items-center">
              <span className="font-bold uppercase text-xs">Amount paid</span>
              <span className="font-bold text-sm">{rs(receipt.payment.amount)}</span>
            </div>

            {receipt.plan && (
              <div className="border-t border-dashed border-slate-300 pt-2 mb-2 space-y-0.5">
                <p className="font-bold uppercase text-[10px] mb-1">Financing status</p>
                <Row label="Device price" value={rs(receipt.plan.totalAmount)} />
                <Row label="Down payment" value={rs(receipt.plan.downPayment)} />
                <Row label="Monthly" value={rs(receipt.plan.monthlyInstallment)} />
                <Row
                  label="Installments paid"
                  value={`${receipt.plan.paidInstallments} of ${receipt.plan.totalInstallments}`}
                />
                {receipt.plan.outstandingLateFees > 0 && (
                  <Row label="Late fees due" value={rs(receipt.plan.outstandingLateFees)} />
                )}
                {receipt.plan.creditBalance > 0 && (
                  <Row label="Advance credit" value={rs(receipt.plan.creditBalance)} />
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-slate-300 mt-1">
                  <span>Balance remaining</span>
                  <span>{rs(receipt.plan.remainingBalance)}</span>
                </div>
              </div>
            )}

            {receipt.payment.notes && (
              <p className="text-[10px] border-t border-dashed border-slate-300 pt-2 mb-2">
                Note: {receipt.payment.notes}
              </p>
            )}

            {receipt.reversal && (
              <p className="text-[10px] border-t border-dashed border-slate-300 pt-2 mb-2">
                Reversed on {new Date(receipt.reversal.reversedAt).toLocaleDateString('en-PK')}: {receipt.reversal.reason}
              </p>
            )}

            <div className="text-center border-t-2 border-dashed border-slate-300 pt-3 mt-3 text-[10px] space-y-0.5">
              <p>Please keep this receipt for your records.</p>
              <p className="text-slate-500">Generated by EMI Shield</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <span className="text-slate-600">{label}</span>
    <span className="font-semibold text-right break-all">{value}</span>
  </div>
);
