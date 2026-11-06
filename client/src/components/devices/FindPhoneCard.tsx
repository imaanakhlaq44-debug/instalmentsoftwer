import React, { useState } from 'react';
import { MapPin, RefreshCw, ExternalLink, Clock, ShieldAlert } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

interface LocationView {
  eligible: boolean;
  reason: string | null;
  requestOpen: boolean;
  requestedAt: string | null;
  requestedBy: string | null;
  location: { lat: number; lng: number; accuracy: number | null; at: string | null } | null;
}

/**
 * Find a locked or overdue phone.
 *
 * Nothing is fetched until the owner opens the card: looking at a customer's
 * location is a deliberate act, and the server records every look. The server
 * also decides whether asking is allowed at all, and says why when it is not.
 */
export const FindPhoneCard: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const { showToast } = useAuth();
  const [view, setView] = useState<LocationView | null>(null);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('Installment overdue and the customer is not answering');

  const load = async () => {
    try {
      setLoading(true);
      setView(await ApiService.getDeviceLocation(deviceId));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const ask = async () => {
    try {
      setAsking(true);
      setView(await ApiService.requestDeviceLocation(deviceId, { reason }));
      showToast('Asked. The phone answers the next time it connects to the internet.', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-3">
      <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
        <MapPin className="w-4 h-4 text-blue-600" /> Find this phone
      </h2>

      {!view ? (
        <>
          <p className="text-xs text-slate-600 leading-relaxed">
            For a locked or overdue phone only, and only if the customer's agreement allows it. Every request and every
            view is recorded.
          </p>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="w-full py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
          >
            {loading ? 'Checking…' : 'Find this phone'}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          {view.location && (
            <div className="p-3 rounded-xl bg-emerald-50 border-2 border-emerald-200 space-y-1.5">
              <p className="text-sm font-extrabold text-emerald-900">Last known location</p>
              <p className="text-xs text-emerald-900 font-mono">
                {view.location.lat.toFixed(5)}, {view.location.lng.toFixed(5)}
                {view.location.accuracy != null && ` · within ${Math.round(view.location.accuracy)} m`}
              </p>
              {view.location.at && (
                <p className="text-xs text-emerald-900">Taken {new Date(view.location.at).toLocaleString()}</p>
              )}
              <a
                href={`https://www.google.com/maps?q=${view.location.lat},${view.location.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-extrabold text-blue-700 underline"
              >
                Open in Google Maps <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {view.requestOpen ? (
            <div className="p-3 rounded-xl bg-amber-50 border-2 border-amber-200 text-xs text-amber-900 space-y-1">
              <p className="font-extrabold flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Waiting for the phone
              </p>
              <p>
                Asked{view.requestedBy ? ` by ${view.requestedBy}` : ''}
                {view.requestedAt ? ` at ${new Date(view.requestedAt).toLocaleString()}` : ''}. The phone answers the next
                time it connects to the internet, usually within 15 minutes. The request stays open for 24 hours.
              </p>
            </div>
          ) : view.eligible ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Reason (recorded)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
              <button
                type="button"
                onClick={ask}
                disabled={asking || reason.trim().length < 5}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              >
                {asking ? 'Asking…' : view.location ? 'Ask for a new location' : 'Ask the phone for its location'}
              </button>
              <p className="text-xs text-slate-600">The customer is shown a notice on the phone when it is shared.</p>
            </div>
          ) : (
            <p className="p-3 rounded-xl bg-slate-50 border-2 border-slate-200 text-xs text-slate-700 flex gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-slate-600" />
              <span>{view.reason}</span>
            </p>
          )}

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="w-full py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      )}
    </div>
  );
};
