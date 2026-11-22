import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { money } from '../../utils/format.js';

/**
 * "Qist jama" for one plan, from wherever the counter already is.
 *
 * The amount starts at what is owed on the plan today; the method is a row of
 * big chips, and only a non-cash payment asks for its transaction ID (the
 * server refuses one without it). The plan is sent along, so the money lands on
 * this phone's installments and not on another plan the same customer has.
 */
export interface RecordPaymentTarget {
  customerId: string;
  customerName: string;
  planId: string;
  suggestedAmount: number;
}

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'BANK_TRANSFER', label: 'Bank' },
] as const;

export const RecordPaymentSheet: React.FC<RecordPaymentTarget & { onClose: () => void; onRecorded: () => void }> = ({
  customerId, customerName, planId, suggestedAmount, onClose, onRecorded,
}) => {
  const { showToast } = useAuth();
  const [amount, setAmount] = useState(String(Math.round(suggestedAmount) || ''));
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter the amount received.'); return; }
    if (method !== 'CASH' && reference.trim().length < 4) { setError('Enter the transaction ID.'); return; }
    setError('');
    setSaving(true);
    try {
      const res = await ApiService.recordPayment({
        customerId,
        planId,
        amount: value,
        paymentMethod: method,
        referenceNumber: method === 'CASH' ? undefined : reference.trim(),
        autoVerify: true,
      });
      showToast(res?.message || 'Payment recorded.', 'success');
      onRecorded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="khata-sheet-backdrop" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-payment-title"
        className="khata-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="khata-sheet-head">
          <div className="min-w-0">
            <p className="khata-eyebrow">Collect payment</p>
            <h2 id="record-payment-title" data-i18n-skip>{customerName}</h2>
          </div>
          <button type="button" className="khata-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </div>

        <label htmlFor="record-payment-amount" className="khata-label">Amount (Rs)</label>
        <input
          id="record-payment-amount"
          className="khata-input"
          inputMode="numeric"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {suggestedAmount > 0 && <p className="khata-hint"><span>Due now</span> <span data-i18n-skip>{money(suggestedAmount)}</span></p>}

        <p className="khata-label" id="record-payment-method">How was it paid?</p>
        <div className="khata-chips" role="radiogroup" aria-labelledby="record-payment-method">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              className={`khata-chip${method === m.value ? ' is-on' : ''}`}
              onClick={() => setMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {method !== 'CASH' && <>
          <label htmlFor="record-payment-ref" className="khata-label">Transaction ID</label>
          <input id="record-payment-ref" className="khata-input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </>}

        {error && <p role="alert" className="khata-error">{error}</p>}
        <button type="submit" className="khata-btn-sun w-full" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</button>
      </form>
    </div>
  );
};
