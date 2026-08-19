import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { ReceiptModal } from '../components/modals/ReceiptModal.js';
import { usePagination } from '../hooks/usePagination.js';
import { SubmitPaymentCard } from '../components/payments/SubmitPaymentCard.js';
import { PendingSubmissions } from '../components/payments/PendingSubmissions.js';
import { csvMoney, csvDateTime, CsvColumn } from '../utils/csv.js';
import {
  CreditCard,
  Search,
  PlusCircle,
  CheckCircle2,
  Clock,
  User,
  ShieldCheck,
  RefreshCw,
  X,
  Smartphone,
} from 'lucide-react';

export const PaymentsPage: React.FC = () => {
  const { selectedDealerId, showToast, isStaff, isDealerAdmin, isCustomer } = useAuth();

  const [payments, setPayments] = useState<any[]>([]);
  const [paymentTotals, setPaymentTotals] = useState<{ verifiedAmount: number; pendingAmount: number; count: number } | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New Payment Form
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formAmount, setFormAmount] = useState(7500);
  const [formMethod, setFormMethod] = useState('JAZZCASH');
  const [formRef, setFormRef] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Receipt + reversal
  const [receiptPaymentId, setReceiptPaymentId] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  const paged = usePagination([searchQuery, selectedDealerId]);

  const paymentQuery = (extra: Record<string, unknown>) => ({
    search: searchQuery || undefined,
    dealerId: selectedDealerId,
    ...extra,
  });

  const paymentCsvColumns: CsvColumn<any>[] = [
    { header: 'Receipt No', value: (p) => p.receiptNumber ?? '' },
    { header: 'Reference', value: (p) => p.referenceNumber },
    { header: 'Date', value: (p) => csvDateTime(p.createdAt) },
    { header: 'Customer', value: (p) => p.customerName },
    { header: 'Phone', value: (p) => p.customerPhone },
    { header: 'Method', value: (p) => p.paymentMethod },
    { header: 'Amount (PKR)', value: (p) => csvMoney(p.amount) },
    { header: 'Late Fee Portion (PKR)', value: (p) => csvMoney(p.lateFeePortion) },
    { header: 'Status', value: (p) => (p.reversedAt ? 'REVERSED' : p.status) },
    { header: 'Reversed On', value: (p) => csvDateTime(p.reversedAt) },
    { header: 'Reversal Reason', value: (p) => p.reversalReason ?? '' },
    { header: 'Notes', value: (p) => p.notes ?? '' },
  ];

  const handleReverse = async () => {
    if (!reverseTarget) return;
    try {
      setReversing(true);
      const res = await ApiService.reversePayment(reverseTarget.id, reverseReason);
      showToast(res.message || 'Payment reversed.', 'success');
      setReverseTarget(null);
      setReverseReason('');
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setReversing(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [payList, custList] = await Promise.all([
        ApiService.getPayments(paymentQuery(paged.params)),
        ApiService.getCustomers({ dealerId: selectedDealerId }),
      ]);
      setPayments(payList.data);
      setPaymentTotals(payList.totals);
      paged.setPagination(payList.pagination);
      setCustomers(custList.data);
      if (custList.data.length > 0 && !formCustomerId) {
        setFormCustomerId(custList.data[0].id);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const ref = formRef || `${formMethod.substring(0, 3)}-${Date.now().toString().slice(-6)}`;
      const res = await ApiService.recordPayment({
        customerId: formCustomerId,
        amount: Number(formAmount),
        paymentMethod: formMethod,
        referenceNumber: ref,
        notes: formNotes,
        autoVerify: true,
      });
      showToast(res.message || 'Payment recorded successfully!', 'success');
      setShowRecordModal(false);
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (paymentId: string) => {
    try {
      const res = await ApiService.verifyPayment(paymentId);
      showToast(res.message || 'Payment verified!', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Installment Payments & Cash Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Accept Cash, JazzCash, Easypaisa, or Bank Transfers with automatic balance reconciliation and instant unlock triggers.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <ExportButton
            fetchPage={(p) => ApiService.getPayments(paymentQuery(p))}
            columns={paymentCsvColumns}
            filenamePrefix="payments"
          />
          {isStaff && (
          <button
            onClick={() => {
              setFormRef(`${formMethod.substring(0, 3)}-${Date.now().toString().slice(-6)}`);
              setShowRecordModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/30 transition-all"
          >
            <PlusCircle className="w-4 h-4" /> Record Installment Payment
          </button>
          )}
        </div>
      </div>

      {/* A customer reports what they have sent; staff work through what has been reported. */}
      {isCustomer && <SubmitPaymentCard onSubmitted={loadData} />}
      {isStaff && <PendingSubmissions onVerified={loadData} />}

      {/* Payments List Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> Loading payment records...
          </div>
        ) : payments.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <CreditCard className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No Payments Recorded</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Receipt Ref #</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Amount Paid</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Verification Status</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {p.referenceNumber}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800 block">{p.customerName}</span>
                      <span className="text-[10px] text-slate-400">{p.customerPhone}</span>
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-emerald-700 text-sm">
                      Rs. {Number(p.amount).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">
                        {p.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {new Date(p.createdAt).toLocaleDateString()} {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`status-pill text-[10px] ${
                          p.status === 'VERIFIED' ? 'status-active' : 'status-pending'
                        }`}
                      >
                        {p.status === 'VERIFIED' ? 'Verified ✓' : 'Pending Verification'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-[11px] max-w-xs truncate">
                      {p.notes || 'Monthly installment'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {/* Verification releases money against the plan and can
                          trigger an auto-unlock, so it stays with the owner. */}
                      {p.status !== 'VERIFIED' ? (
                        isDealerAdmin ? (
                          <button
                            onClick={() => handleVerify(p.id)}
                            className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold rounded-lg text-xs transition-colors"
                          >
                            Verify Payment
                          </button>
                        ) : (
                          <span className="text-[11px] text-amber-600 font-medium">Awaiting owner</span>
                        )
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setReceiptPaymentId(p.id)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] transition-colors"
                            title="View and print the customer receipt"
                          >
                            Receipt
                          </button>
                          {/* Reversal moves real money back — owner only. */}
                          {isDealerAdmin && !p.reversedAt && (
                            <button
                              onClick={() => {
                                setReverseTarget(p);
                                setReverseReason('');
                              }}
                              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-[11px] transition-colors"
                              title="Reverse this payment (bounced cheque, wrong entry)"
                            >
                              Reverse
                            </button>
                          )}
                          {p.reversedAt && (
                            <span className="text-[11px] text-rose-600 font-semibold">Reversed</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="payments"
              disabled={loading}
            />
          </div>
        )}
      </div>

      {receiptPaymentId && (
        <ReceiptModal paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />
      )}

      {/* MODAL: Reverse Payment */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl border border-rose-100">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <X className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Reverse this payment?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Rs. {Number(reverseTarget.amount).toLocaleString()} from{' '}
                <strong>{reverseTarget.customerName}</strong> will be taken back off the plan and the
                balance will increase. The original receipt stays in the ledger with a matching
                reversal entry.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason * <span className="font-normal text-slate-400">(at least 10 characters)</span>
              </label>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                placeholder="e.g. Cheque returned unpaid by bank on 17 Aug"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setReverseTarget(null)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReverse}
                disabled={reversing || reverseReason.trim().length < 10}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors"
              >
                {reversing ? 'Reversing…' : 'Confirm Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Record Payment */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-emerald-600">Cash & Digital Desk</span>
                <h3 className="text-base font-bold text-slate-900">Record Installment Payment</h3>
              </div>
              <button onClick={() => setShowRecordModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Customer *</label>
                <select
                  value={formCustomerId}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone}) - Outstanding: Rs. {Number(c.outstandingBalance || 0).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Amount Received (PKR) *</label>
                <input
                  type="number"
                  required
                  value={formAmount}
                  onChange={(e) => setFormAmount(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={formMethod}
                  onChange={(e) => {
                    setFormMethod(e.target.value);
                    setFormRef(`${e.target.value.substring(0, 3)}-${Date.now().toString().slice(-6)}`);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium"
                >
                  <option value="JAZZCASH">JazzCash</option>
                  <option value="EASYPAISA">Easypaisa</option>
                  <option value="CASH">Cash at Counter</option>
                  <option value="BANK_TRANSFER">Bank Transfer (Raast / 1-Link)</option>
                  <option value="ONLINE">Online Portal</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference / Transaction ID</label>
                <input
                  type="text"
                  value={formRef}
                  onChange={(e) => setFormRef(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Received by counter staff"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800">
                ✨ <strong>Auto-Unlock Engine:</strong> If this payment clears all overdue balances, any restricted locked device will automatically be signaled to restore full access!
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRecordModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30"
                >
                  {submitting ? 'Crediting...' : 'Record & Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
