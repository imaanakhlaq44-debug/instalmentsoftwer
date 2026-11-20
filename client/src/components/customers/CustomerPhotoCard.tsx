import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Loader2, UserRound, X } from 'lucide-react';
import { ApiError, ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { CustomerPhotoPicker } from './CustomerPhotoPicker.js';

interface Props {
  customerId: string;
  customerName: string;
  hasPhoto: boolean;
  /** View-only staff see the photo but get no add, retake or remove. */
  readOnly?: boolean;
}

/**
 * The customer's photo on their page: a thumbnail that opens full size, and
 * for shop staff a way to add, retake or remove it.
 */
export const CustomerPhotoCard: React.FC<Props> = ({ customerId, customerName, hasPhoto, readOnly = false }) => {
  const { showToast } = useAuth();
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasPhoto);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!hasPhoto) {
      setPhoto(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ApiService.getCustomerPhoto(customerId)
      .then((res) => {
        if (!cancelled) setPhoto(res.photo);
      })
      .catch(() => {
        if (!cancelled) setPhoto(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, hasPhoto]);

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      if (next) await ApiService.setCustomerPhoto(customerId, next);
      else await ApiService.deleteCustomerPhoto(customerId);
      setPhoto(next);
      setEditing(false);
      showToast(next ? 'Photo saved.' : 'Photo removed.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'The photo could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => (photo ? setZoomed(true) : !readOnly && setEditing(true))}
          disabled={readOnly && !photo && !loading}
          className="block h-16 w-16 overflow-hidden rounded-xl border border-slate-300 bg-slate-100 sm:h-20 sm:w-20"
          aria-label={
            photo ? `Show ${customerName}'s photo` : readOnly ? `No photo of ${customerName}` : `Add ${customerName}'s photo`
          }
        >
          {loading ? (
            <span className="grid h-full w-full place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </span>
          ) : photo ? (
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-slate-400">
              <UserRound className="h-8 w-8" aria-hidden="true" />
            </span>
          )}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="absolute -bottom-1.5 -end-1.5 grid h-7 w-7 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
            aria-label={photo ? 'Change photo' : 'Add photo'}
            title={photo ? 'Change photo' : 'Add photo'}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {editing &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Customer photo"
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4"
            onClick={() => !saving && setEditing(false)}
          >
            <div className="surface w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-title font-black text-ink-900">Customer photo</p>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="btn-ghost px-2"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <CustomerPhotoPicker
                value={photo}
                onChange={(next) => void save(next)}
                disabled={saving}
                hint={saving ? 'Saving…' : 'The new photo is saved straight away.'}
              />
            </div>
          </div>,
          document.body
        )}

      {zoomed &&
        photo &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${customerName}'s photo`}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-4"
            onClick={() => setZoomed(false)}
          >
            <img src={photo} alt={`${customerName}`} className="max-h-[85vh] max-w-full rounded-xl object-contain" />
            <button
              type="button"
              className="absolute end-4 top-4 rounded-full bg-white p-2"
              aria-label="Close photo"
              onClick={() => setZoomed(false)}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>,
          document.body
        )}
    </>
  );
};
