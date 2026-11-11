import React, { useEffect, useState } from 'react';
import { MessageCircle, X, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

/**
 * Click-to-WhatsApp.
 *
 * Opens the shop's own WhatsApp with a message already typed in. The text is
 * written by the server from the plan's real figures; this component only
 * shows it and opens the link. The person at the counter still presses send in
 * WhatsApp — which is why everything here says "open" and nothing says "sent".
 */

export type WhatsAppKind = 'DUE_REMINDER' | 'OVERDUE' | 'PAYMENT_RECEIVED' | 'LOCK_WARNING';

export const WHATSAPP_KIND_LABELS: Record<WhatsAppKind, string> = {
  DUE_REMINDER: 'Due reminder',
  OVERDUE: 'Overdue notice',
  PAYMENT_RECEIVED: 'Payment receipt',
  LOCK_WARNING: 'Lock warning',
};

const KINDS = Object.keys(WHATSAPP_KIND_LABELS) as WhatsAppKind[];

export interface WhatsAppTarget {
  customerId: string;
  customerName: string;
  /** The message the modal opens on. The person can switch to another. */
  kind: WhatsAppKind;
  installmentId?: string;
  planId?: string;
  paymentId?: string;
}

interface ModalProps extends WhatsAppTarget {
  onClose: () => void;
  /** Called after the open has been recorded, so a page can refresh its history. */
  onOpened?: () => void;
}

export const WhatsAppModal: React.FC<ModalProps> = ({
  customerId, customerName, kind: initialKind, installmentId, planId, paymentId, onClose, onOpened,
}) => {
  const { showToast } = useAuth();
  const [kind, setKind] = useState<WhatsAppKind>(initialKind);
  const [composed, setComposed] = useState<{ message: string; url: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const request = { customerId, kind, installmentId, planId, paymentId: kind === 'PAYMENT_RECEIVED' ? paymentId : undefined };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setComposed(null);

    ApiService.getWhatsAppMessage(request)
      .then((res) => {
        if (!cancelled) setComposed(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'This message could not be prepared.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, kind, installmentId, planId, paymentId]);

  /**
   * The link is a real anchor, so the browser opens it as a plain user click —
   * no pop-up blocker involved. Recording runs alongside and must never stop
   * the chat from opening.
   */
  const recordOpen = () => {
    ApiService.recordWhatsAppOpened(request)
      .then(() => onOpened?.())
      .catch(() => showToast('WhatsApp opened, but it could not be added to the customer record.', 'error'));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`WhatsApp message for ${customerName}`}
    >
      <div className="bg-white rounded-2xl w-full max-w-md my-8 shadow-overlay border-2 border-ink-900 text-left">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-900">WhatsApp message</h2>
            <p className="text-xs text-slate-500 truncate" data-i18n-skip="true">
              {customerName}
              {composed ? ` · ${composed.phone}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Message type">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  kind === k ? 'bg-navy-950 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {WHATSAPP_KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {loading && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Preparing message…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200" role="alert">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-amber-900">{error}</p>
            </div>
          )}

          {composed && (
            <>
              {/* Written by the server in the shop's chosen language. The page
                  translator must leave it exactly as the customer will read it. */}
              <p
                data-i18n-skip="true"
                data-testid="whatsapp-message"
                dir="auto"
                className="whitespace-pre-wrap p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-slate-800 leading-relaxed"
              >
                {composed.message}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                This opens your own WhatsApp with the message typed in. You press send there. We record that it
                was opened and by whom — not that it was sent or delivered, because that cannot be known.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          {composed && (
            <a
              href={composed.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={recordOpen}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              Open WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

interface ButtonProps extends WhatsAppTarget {
  /** `icon` for a tight row of actions, `button` where there is room for the word. */
  variant?: 'icon' | 'button';
  onOpened?: () => void;
}

export const WhatsAppButton: React.FC<ButtonProps> = ({ variant = 'button', onOpened, ...target }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost h-8 w-8 rounded-md p-0 text-emerald-700"
          title={`WhatsApp ${target.customerName}`}
          aria-label={`WhatsApp ${target.customerName}`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg text-xs transition-colors"
          aria-label={`WhatsApp ${target.customerName}`}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          WhatsApp
        </button>
      )}
      {open && <WhatsAppModal {...target} onClose={() => setOpen(false)} onOpened={onOpened} />}
    </>
  );
};
