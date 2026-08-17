import React, { useState, useEffect } from 'react';
import { X, Loader2, UserRound } from 'lucide-react';
import { ApiService, ApiError } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

interface Props {
  customer: any;
  onClose: () => void;
  onSaved: () => void;
}

type Field = 'name' | 'phone' | 'cnic' | 'address' | 'emergencyContactName' | 'emergencyContactPhone' | 'notes';

const FIELDS: { key: Field; label: string; placeholder: string; textarea?: boolean; hint?: string }[] = [
  { key: 'name', label: 'Full name', placeholder: 'Muhammad Ali' },
  { key: 'phone', label: 'Mobile number', placeholder: '0300-1234567', hint: 'Pakistani mobile, e.g. 0300-1234567' },
  { key: 'cnic', label: 'CNIC', placeholder: '35202-1234567-1', hint: '13 digits' },
  { key: 'address', label: 'Address', placeholder: 'House 14B, Model Town, Lahore', textarea: true },
  { key: 'emergencyContactName', label: 'Emergency contact name', placeholder: 'Asad Ali (Brother)' },
  { key: 'emergencyContactPhone', label: 'Emergency contact phone', placeholder: '0302-1234567' },
  { key: 'notes', label: 'Notes', placeholder: 'Anything worth remembering about this customer', textarea: true },
];

/**
 * Corrects a customer record.
 *
 * Until now a name or CNIC typed wrong at the counter was permanent — there was
 * no update endpoint and no form. Only changed fields are sent, so an edit
 * cannot accidentally blank out a field the user never touched.
 */
export const EditCustomerModal: React.FC<Props> = ({ customer, onClose, onSaved }) => {
  const { showToast } = useAuth();

  const [values, setValues] = useState<Record<Field, string>>({
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    cnic: customer.cnic ?? '',
    address: customer.address ?? '',
    emergencyContactName: customer.emergencyContactName ?? '',
    emergencyContactPhone: customer.emergencyContactPhone ?? '',
    notes: customer.notes ?? '',
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const setValue = (key: Field, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    // Send only what actually changed.
    const changes: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const original = (customer[key] ?? '') as string;
      if (values[key].trim() !== String(original).trim()) {
        changes[key] = values[key].trim();
      }
    }

    if (Object.keys(changes).length === 0) {
      setFormError('Nothing has been changed yet.');
      return;
    }

    try {
      setSaving(true);
      await ApiService.updateCustomer(customer.id, changes);
      showToast(`${values.name} updated.`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = err.fieldErrors;
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setFormError(err.message);
      } else {
        setFormError('Could not save the changes. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Edit customer"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl w-full max-w-lg my-8 shadow-2xl border border-slate-200"
        noValidate
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <UserRound className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Edit customer</h2>
              <p className="text-[11px] text-slate-500">Correct details captured at the counter</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {formError && (
            <div role="alert" className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {formError}
            </div>
          )}

          {FIELDS.map(({ key, label, placeholder, textarea, hint }) => (
            <div key={key}>
              <label htmlFor={`edit-${key}`} className="block text-xs font-semibold text-slate-700 mb-1">
                {label}
              </label>
              {textarea ? (
                <textarea
                  id={`edit-${key}`}
                  rows={2}
                  value={values[key]}
                  onChange={(e) => setValue(key, e.target.value)}
                  placeholder={placeholder}
                  className={`w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                    fieldErrors[key] ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                  }`}
                />
              ) : (
                <input
                  id={`edit-${key}`}
                  type="text"
                  value={values[key]}
                  onChange={(e) => setValue(key, e.target.value)}
                  placeholder={placeholder}
                  className={`w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                    fieldErrors[key] ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                  }`}
                />
              )}
              {fieldErrors[key] ? (
                <p className="mt-1 text-[11px] text-rose-600">{fieldErrors[key]}</p>
              ) : hint ? (
                <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold transition-colors"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
};
