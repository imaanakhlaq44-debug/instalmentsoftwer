import React, { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { previewSchedule } from '../../utils/schedule.js';

/**
 * The two owner-only adjustments to a plan: restructuring what is still owed,
 * and forgiving a late fee. Both need a written reason, which the server keeps
 * in the audit log, and both show the server's own words when it refuses.
 */

const MIN_REASON = 10;
const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

const Shell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4">
    <div role="dialog" aria-modal="true" aria-label={title} className="surface w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-extrabold text-ink-900">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const ReasonField: React.FC<{ id: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({
  id,
  value,
  onChange,
  placeholder,
}) => (
  <div>
    <label htmlFor={id} className="field-label">Reason (required)</label>
    <textarea
      id={id}
      rows={3}
      maxLength={500}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input"
    />
    {value.trim().length < MIN_REASON && (
      <p className="mt-1 text-micro text-ink-500">Write at least 10 characters.</p>
    )}
  </div>
);

const ErrorLine: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <p role="alert" className="rounded-md border-2 border-critical-200 bg-critical-50 px-3 py-2 text-xs font-bold text-critical-700">
      {error}
    </p>
  ) : null;

// ---------------------------------------------------------------------------

export const RestructurePlanModal: React.FC<{
  plan: any;
  installments: any[];
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ plan, installments, onClose, onDone }) => {
  const paid = installments.filter((i) => i.amountPaid > 0 || i.status === 'PAID');
  const unpaid = installments.filter((i) => !(i.amountPaid > 0 || i.status === 'PAID'));
  const paidSoFar = installments.reduce((s, i) => s + Number(i.amountPaid || 0), 0);
  const outstanding = Math.max(0, Number(plan.financedAmount || 0) - paidSoFar);

  const [months, setMonths] = useState(String(Math.max(1, unpaid.length || 1)));
  const [firstDueDate, setFirstDueDate] = useState<string>(unpaid[0]?.dueDate ?? '');
  const [graceDays, setGraceDays] = useState(String(plan.gracePeriodDays ?? 0));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      previewSchedule({
        outstanding,
        months: Number(months),
        firstDueDate,
        graceDays: Number(graceDays) || 0,
        startAfter: paid.length,
      }),
    [outstanding, months, firstDueDate, graceDays, paid.length]
  );

  const canConfirm = rows.length > 0 && reason.trim().length >= MIN_REASON && !saving;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await ApiService.reschedulePlan(plan.id, {
        totalInstallments: Number(months),
        firstDueDate,
        gracePeriodDays: Number(graceDays) || 0,
        reason: reason.trim(),
      });
      onDone(res?.message || 'Plan restructured.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell title="Restructure this plan" onClose={onClose}>
      <p className="text-xs text-ink-500">
        Paid installments stay as they are. What is still owed is spread over new months.
      </p>

      <div className="flex justify-between rounded-md border-2 border-ink-900 bg-sun-100 px-3 py-2 text-xs">
        <span className="font-bold text-ink-700">Still owed</span>
        <span className="font-extrabold text-ink-900">{money(outstanding)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="rs-months" className="field-label">Number of new months</label>
          <input id="rs-months" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="rs-first" className="field-label">First new due date</label>
          <input id="rs-first" type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="rs-grace" className="field-label">Grace days</label>
          <input id="rs-grace" type="number" min={0} max={30} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className="input" />
        </div>
      </div>

      <div>
        <p className="eyebrow mb-1.5">New schedule</p>
        {rows.length === 0 ? (
          <p className="well px-3 py-2 text-xs text-ink-500">Enter the months and the first due date to see the new schedule.</p>
        ) : (
          <table aria-label="New schedule" className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-ink-900 text-ink-500 uppercase text-micro">
                <th className="py-1.5">#</th>
                <th className="py-1.5">Due Date</th>
                <th className="py-1.5">Amount</th>
                <th className="py-1.5">Grace Until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {rows.map((r) => (
                <tr key={r.installmentNumber}>
                  <td className="py-1.5 font-bold">#{r.installmentNumber}</td>
                  <td className="py-1.5">{r.dueDate}</td>
                  <td className="py-1.5 font-bold">{money(r.amountDue)}</td>
                  <td className="py-1.5 text-ink-500">{r.graceDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-2 rounded-md border-2 border-ink-900 bg-sun-100 p-3 text-xs text-ink-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-extrabold">The signed agreement will no longer match.</p>
          <p className="mt-0.5">
            Restructuring changes the figures the customer signed. Until a new agreement is signed, this phone cannot be locked.
          </p>
        </div>
      </div>

      <ReasonField id="rs-reason" value={reason} onChange={setReason} placeholder="Why is this plan being restructured?" />
      <ErrorLine error={error} />

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={confirm} disabled={!canConfirm} className="btn-primary">
          {saving ? 'Saving...' : 'Confirm restructure'}
        </button>
      </div>
    </Shell>
  );
};

// ---------------------------------------------------------------------------

export const WaiveLateFeeModal: React.FC<{
  installment: any;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ installment, onClose, onDone }) => {
  const fee = Math.max(0, Number(installment.lateFee || 0) - Number(installment.lateFeePaid || 0));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await ApiService.waiveLateFee(installment.id, reason.trim());
      onDone(res?.message || 'Late fee waived.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell title="Waive the late fee" onClose={onClose}>
      <div className="flex justify-between rounded-md border-2 border-ink-900 bg-sun-100 px-3 py-2 text-xs">
        <span className="font-bold text-ink-700">Late fee owed</span>
        <span className="font-extrabold text-ink-900">{money(fee)}</span>
      </div>
      <p className="text-xs text-ink-500">The installment itself is still owed. Only the late fee is removed.</p>

      <ReasonField id="wv-reason" value={reason} onChange={setReason} placeholder="Why is this late fee being waived?" />
      <ErrorLine error={error} />

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button
          type="button"
          onClick={confirm}
          disabled={reason.trim().length < MIN_REASON || saving}
          className="btn-primary"
        >
          {saving ? 'Saving...' : 'Confirm waiver'}
        </button>
      </div>
    </Shell>
  );
};
