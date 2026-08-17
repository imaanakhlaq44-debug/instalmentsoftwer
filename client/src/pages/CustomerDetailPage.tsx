import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, CreditCard, Smartphone, Loader2, AlertTriangle,
  UserRound, ShieldAlert, Wallet, Receipt, Pencil,
} from 'lucide-react';
import { ApiService, ApiError } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { ReceiptModal } from '../components/modals/ReceiptModal.js';
import { EditCustomerModal } from '../components/modals/EditCustomerModal.js';

const rs = (n: number) => `Rs. ${Math.round(n || 0).toLocaleString('en-PK')}`;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
  LOCK_PENDING: 'bg-orange-50 text-orange-700 border-orange-200',
  UNLOCK_PENDING: 'bg-sky-50 text-sky-700 border-sky-200',
  OVERDUE: 'bg-amber-50 text-amber-700 border-amber-200',
  PENDING: 'bg-slate-100 text-slate-600 border-slate-200',
  ENROLLED: 'bg-blue-50 text-blue-700 border-blue-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CURRENT: 'bg-blue-50 text-blue-700 border-blue-200',
};

const Badge: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${
      STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
    }`}
  >
    {status.replace(/_/g, ' ')}
  </span>
);

const StatTile: React.FC<{ label: string; value: string; icon: React.ElementType; tone?: string }> = ({
  label,
  value,
  icon: Icon,
  tone = 'text-slate-900',
}) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4">
    <div className="flex items-center gap-2 text-slate-500 mb-1.5">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
    <p className={`text-lg font-bold ${tone}`}>{value}</p>
  </div>
);

export const CustomerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast, isDealerAdmin } = useAuth();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiptPaymentId, setReceiptPaymentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      setData(await ApiService.getCustomer(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this customer.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 className="w-7 h-7 text-blue-600 animate-spin" aria-hidden="true" />
        <p className="text-sm text-slate-500">Loading customer…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
        <p className="text-sm text-slate-600 max-w-sm">{error ?? 'Customer not found.'}</p>
        <button
          onClick={() => navigate('/customers')}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold"
        >
          Back to customers
        </button>
      </div>
    );
  }

  const { customer, devices, plans, installments, payments, summary } = data;
  const overdueRows = installments.filter((i: any) => i.status === 'OVERDUE');

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            aria-label="Back to customers"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-slate-900">{customer.name}</h1>
              {!customer.active && <Badge status="INACTIVE" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3 h-3" aria-hidden="true" /> {customer.phone}
              </span>
              <span className="flex items-center gap-1.5">
                <CreditCard className="w-3 h-3" aria-hidden="true" /> {customer.cnic}
                {customer.cnicMasked && <span className="text-slate-400">(masked)</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3 h-3" aria-hidden="true" /> {customer.address}
              </span>
            </div>
          </div>
        </div>

        {isDealerAdmin && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            Edit details
          </button>
        )}
      </div>

      {overdueRows.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-amber-900">
              {overdueRows.length} overdue installment{overdueRows.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              {rs(overdueRows.reduce((s: number, i: any) => s + (i.totalOutstanding ?? i.amountDue - i.amountPaid), 0))}{' '}
              outstanding, including any late fees.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Outstanding" value={rs(summary.outstandingBalance)} icon={Wallet} tone="text-slate-900" />
        <StatTile label="Total paid" value={rs(summary.totalPaid)} icon={Receipt} tone="text-emerald-700" />
        <StatTile
          label="Late fees"
          value={rs(summary.outstandingLateFees)}
          icon={AlertTriangle}
          tone={summary.outstandingLateFees > 0 ? 'text-amber-700' : 'text-slate-900'}
        />
        <StatTile
          label="Advance credit"
          value={rs(summary.creditBalance)}
          icon={UserRound}
          tone={summary.creditBalance > 0 ? 'text-blue-700' : 'text-slate-900'}
        />
      </div>

      {/* Emergency contact — the person the shop calls when the customer stops answering. */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Emergency contact</h2>
        <p className="text-sm text-slate-900 font-semibold">{customer.emergencyContactName}</p>
        <p className="text-xs text-slate-500">{customer.emergencyContactPhone}</p>
      </div>

      <section>
        <h2 className="text-sm font-bold text-slate-900 mb-3">Financed devices ({devices.length})</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-6 text-center">
            No devices financed by this customer yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {devices.map((d: any) => {
              const plan = plans.find((p: any) => p.deviceId === d.id);
              return (
                <Link
                  key={d.id}
                  to={`/devices/${d.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Smartphone className="w-4 h-4 text-slate-600" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {d.brand} {d.model}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono">{d.maskedImei}</p>
                      </div>
                    </div>
                    <Badge status={d.status} />
                  </div>

                  {plan && (
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Monthly</p>
                        <p className="text-xs font-bold text-slate-900">{rs(plan.monthlyInstallment)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Progress</p>
                        <p className="text-xs font-bold text-slate-900">
                          {plan.paidInstallments}/{plan.totalInstallments}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Balance</p>
                        <p className="text-xs font-bold text-slate-900">{rs(plan.remainingBalance)}</p>
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-slate-900 mb-3">Installment schedule</h2>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">#</th>
                  <th className="px-4 py-2.5 font-semibold">Due date</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Paid</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Late fee</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {installments.map((i: any) => (
                  <tr key={i.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 text-slate-500">{i.installmentNumber}</td>
                    <td className="px-4 py-2.5 text-slate-700">{i.dueDate}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{rs(i.amountDue)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{rs(i.amountPaid)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700">
                      {i.lateFee > 0 ? rs(i.lateFee - (i.lateFeePaid ?? 0)) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge status={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-slate-900 mb-3">Payment history</h2>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500 p-6 text-center">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">Receipt</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Method</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p: any) => (
                    <tr key={p.id} className={p.reversedAt ? 'opacity-60' : 'hover:bg-slate-50/60'}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {p.receiptNumber || p.referenceNumber}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {new Date(p.createdAt).toLocaleDateString('en-PK')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{p.paymentMethod}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                        {p.reversedAt && <span className="line-through">{rs(p.amount)}</span>}
                        {!p.reversedAt && rs(p.amount)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge status={p.reversedAt ? 'REVERSED' : p.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {p.status === 'VERIFIED' && (
                          <button
                            onClick={() => setReceiptPaymentId(p.id)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px] transition-colors"
                          >
                            Print
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {receiptPaymentId && (
        <ReceiptModal paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />
      )}

      {editing && (
        <EditCustomerModal customer={customer} onClose={() => setEditing(false)} onSaved={load} />
      )}
    </div>
  );
};

export default CustomerDetailPage;
