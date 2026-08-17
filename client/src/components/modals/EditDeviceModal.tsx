import React, { useState, useEffect } from 'react';
import { X, Loader2, Smartphone, ShieldAlert } from 'lucide-react';
import { ApiService, ApiError } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

interface Props {
  device: any;
  onClose: () => void;
  onSaved: () => void;
}

type Field = 'brand' | 'model' | 'color' | 'ramStorage' | 'serialNumber' | 'simCarrier';

const FIELDS: { key: Field; label: string; placeholder: string }[] = [
  { key: 'brand', label: 'Brand', placeholder: 'Samsung' },
  { key: 'model', label: 'Model', placeholder: 'Galaxy A55' },
  { key: 'color', label: 'Colour', placeholder: 'Black' },
  { key: 'ramStorage', label: 'RAM / Storage', placeholder: '8GB / 128GB' },
  { key: 'serialNumber', label: 'Serial number', placeholder: 'SNSAM123456' },
  { key: 'simCarrier', label: 'SIM carrier', placeholder: 'Jazz' },
];

/**
 * Device record editor.
 *
 * IMEI is deliberately NOT part of the general form. It is the device's
 * identity — every future lock or unlock command depends on it — so changing it
 * requires its own confirmed action with a written reason, and lands in the
 * audit trail as a distinct event.
 */
export const EditDeviceModal: React.FC<Props> = ({ device, onClose, onSaved }) => {
  const { showToast } = useAuth();

  const [values, setValues] = useState<Record<Field, string>>({
    brand: device.brand ?? '',
    model: device.model ?? '',
    color: device.color ?? '',
    ramStorage: device.ramStorage ?? '',
    serialNumber: device.serialNumber ?? '',
    simCarrier: device.simCarrier ?? '',
  });

  const [showImeiSection, setShowImeiSection] = useState(false);
  const [newImei, setNewImei] = useState('');
  const [imeiReason, setImeiReason] = useState('');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const changes: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const original = (device[key] ?? '') as string;
      if (values[key].trim() && values[key].trim() !== String(original).trim()) {
        changes[key] = values[key].trim();
      }
    }

    const imeiChanging = showImeiSection && newImei.trim().length > 0;

    if (Object.keys(changes).length === 0 && !imeiChanging) {
      setFormError('Nothing has been changed yet.');
      return;
    }

    try {
      setSaving(true);

      if (Object.keys(changes).length > 0) {
        await ApiService.updateDevice(device.id, changes);
      }

      if (imeiChanging) {
        await ApiService.correctImei(device.id, {
          imei: newImei.trim(),
          reason: imeiReason.trim(),
        });
      }

      showToast(`${values.brand} ${values.model} updated.`, 'success');
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

  const imeiValid = /^\d{15}$/.test(newImei.trim());
  const imeiReadyToSubmit = !showImeiSection || newImei.trim().length === 0 || (imeiValid && imeiReason.trim().length >= 10);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Edit device"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl w-full max-w-lg my-8 shadow-2xl border border-slate-200"
        noValidate
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Smartphone className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Edit device</h2>
              <p className="text-[11px] text-slate-500 font-mono">{device.maskedImei}</p>
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

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label htmlFor={`dev-${key}`} className="block text-xs font-semibold text-slate-700 mb-1">
                  {label}
                </label>
                <input
                  id={`dev-${key}`}
                  type="text"
                  value={values[key]}
                  onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className={`w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                    fieldErrors[key] ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                  }`}
                />
                {fieldErrors[key] && <p className="mt-1 text-[11px] text-rose-600">{fieldErrors[key]}</p>}
              </div>
            ))}
          </div>

          {/* IMEI correction — gated behind a deliberate click */}
          <div className="border-t border-slate-100 pt-4">
            {!showImeiSection ? (
              <button
                type="button"
                onClick={() => setShowImeiSection(true)}
                className="text-xs font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2"
              >
                Correct the IMEI…
              </button>
            ) : (
              <div className="space-y-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-[11px] text-amber-900">
                    The IMEI identifies this handset. Every lock and unlock command depends on it, so
                    this change is recorded separately in the audit trail with your reason.
                  </p>
                </div>

                <div>
                  <label htmlFor="new-imei" className="block text-xs font-semibold text-slate-700 mb-1">
                    Correct IMEI <span className="font-normal text-slate-500">(15 digits — dial *#06# on the phone)</span>
                  </label>
                  <input
                    id="new-imei"
                    type="text"
                    inputMode="numeric"
                    value={newImei}
                    onChange={(e) => setNewImei(e.target.value.replace(/\D/g, '').slice(0, 15))}
                    placeholder="356938035643809"
                    className={`w-full px-3 py-2 border rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${
                      fieldErrors.imei || (newImei.length > 0 && !imeiValid) ? 'border-rose-400 bg-rose-50/50' : 'border-amber-300'
                    }`}
                  />
                  {fieldErrors.imei ? (
                    <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.imei}</p>
                  ) : (
                    newImei.length > 0 && !imeiValid && (
                      <p className="mt-1 text-[11px] text-rose-600">IMEI must be exactly 15 digits.</p>
                    )
                  )}
                </div>

                <div>
                  <label htmlFor="imei-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                    Reason * <span className="font-normal text-slate-500">(at least 10 characters)</span>
                  </label>
                  <textarea
                    id="imei-reason"
                    rows={2}
                    value={imeiReason}
                    onChange={(e) => setImeiReason(e.target.value)}
                    placeholder="e.g. Digits transposed during registration; verified against handset"
                    className={`w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${
                      fieldErrors.reason ? 'border-rose-400 bg-rose-50/50' : 'border-amber-300'
                    }`}
                  />
                  {fieldErrors.reason && <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.reason}</p>}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowImeiSection(false);
                    setNewImei('');
                    setImeiReason('');
                  }}
                  className="text-[11px] text-slate-600 hover:text-slate-900 underline underline-offset-2"
                >
                  Cancel IMEI correction
                </button>
              </div>
            )}
          </div>
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
            disabled={saving || !imeiReadyToSubmit}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
};
