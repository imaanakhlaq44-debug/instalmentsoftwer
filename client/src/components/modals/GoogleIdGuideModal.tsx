import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
  Key,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';

interface GoogleIdGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToSettings?: () => void;
}

type GuideLang = 'both' | 'roman' | 'en';

const PEOPLE_API_EXPLORER_URL = 'https://developers.google.com/people/api/rest/v1/people/get';

export const GoogleIdGuideModal: React.FC<GoogleIdGuideModalProps> = ({
  isOpen,
  onClose,
  onGoToSettings,
}) => {
  const [lang, setLang] = useState<GuideLang>('both');
  const [copiedField, setCopiedField] = useState<'resourceName' | 'personFields' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showEn = lang === 'both' || lang === 'en';
  const showRo = lang === 'both' || lang === 'roman';

  const copyValue = (field: 'resourceName' | 'personFields', value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField((curr) => (curr === field ? null : curr));
    }, 1800);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-id-guide-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div
        data-i18n-skip="true"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl overflow-hidden rounded-3xl border-2 border-ink-900 bg-white shadow-overlay max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 bg-navy-950 px-6 py-4 text-white shrink-0">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-400 text-ink-900">
              <Key className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Factory Reset Protection (FRP)
              </p>
              <h2 id="google-id-guide-title" className="text-base sm:text-lg font-extrabold text-white">
                {lang === 'roman'
                  ? 'Google Account ID Kaise Nikalein'
                  : lang === 'en'
                  ? 'How to Get Your Numeric Google Account ID'
                  : 'Google Account ID Guide — ID Kahan Se Aur Kaise Lein'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Language Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2.5 shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <HelpCircle className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
            Language / Zuban:
          </span>
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'both', label: 'Both (Eng + Roman Urdu)' },
                { id: 'roman', label: 'Roman Urdu' },
                { id: 'en', label: 'English' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLang(tab.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  lang === tab.id
                    ? 'bg-ink-900 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="space-y-4 overflow-y-auto p-6 text-xs leading-relaxed">
          {/* Critical Warning */}
          <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 space-y-1.5 text-amber-950">
            <div className="flex items-center gap-2 font-extrabold text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>Important Warning / Zaroori Hidyat</span>
            </div>
            {showEn && (
              <p>
                <strong>Do NOT enter your Gmail address or phone number.</strong> Android requires your{' '}
                <strong>21-digit numeric Google Account ID</strong> (example:{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">118223344556677889900</code>).
                Use a dedicated <strong>Shop Gmail with 2-Step Verification ON</strong> — never your personal email.
              </p>
            )}
            {showRo && (
              <p className={showEn ? 'border-t border-amber-200/80 pt-1.5 text-amber-900' : ''}>
                <strong>Yahan @gmail.com ya phone number har giz mat likhein!</strong> Android sirf Google account ka{' '}
                <strong>21 hindson wala number ID</strong> qabool karta hai (misaal:{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">118223344556677889900</code>).
                Dukaan ke liye ek <strong>alag Shop Gmail</strong> banayein aur us par{' '}
                <strong>2-Step Verification ON</strong> rakhein — apna zati email na daalein.
              </p>
            )}
          </div>

          {/* 4 Steps */}
          <div className="space-y-3">
            {/* Step 1 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-extrabold text-slate-900 text-sm">
                  1. Open Google People API Explorer
                </p>
                <a
                  href={PEOPLE_API_EXPLORER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-500"
                >
                  Open Google ID Finder <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
              {showEn && (
                <p className="text-slate-600">
                  Open Google&apos;s official API Explorer page above and make sure you are signed in with your{' '}
                  <strong>Shop Gmail account</strong> (the account allowed to unlock reset phones).
                </p>
              )}
              {showRo && (
                <p className="text-slate-800">
                  Upar diye gaye button se Google ka official page kholein aur apni{' '}
                  <strong>Dukaan wali Gmail</strong> se login karein (woh Gmail jis se format shuda phone khulwana ho).
                </p>
              )}
            </div>

            {/* Step 2 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
              <p className="font-extrabold text-slate-900 text-sm">
                2. Fill the 2 fields in &ldquo;Try this method&rdquo;
              </p>
              {showEn && (
                <p className="text-slate-600">
                  On the right side of Google&apos;s page (or below on mobile) inside <strong>Try this method</strong>,
                  enter these exact two values:
                </p>
              )}
              {showRo && (
                <p className="text-slate-800">
                  Google ke page par <strong>&ldquo;Try this method&rdquo;</strong> wale dabbe mein yeh dono lafz bilkul
                  isi tarah likhein (neeche Copy button daba kar bhi le sakte hain):
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500">resourceName</span>
                    <code className="font-mono font-extrabold text-slate-900 text-xs">people/me</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyValue('resourceName', 'people/me')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {copiedField === 'resourceName' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500">personFields</span>
                    <code className="font-mono font-extrabold text-slate-900 text-xs">metadata</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyValue('personFields', 'metadata')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {copiedField === 'personFields' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-1.5">
              <p className="font-extrabold text-slate-900 text-sm">
                3. Click &ldquo;Execute&rdquo; and allow permission
              </p>
              {showEn && (
                <p className="text-slate-600">
                  Scroll down in that panel and click the blue <strong>Execute</strong> button. If Google pops up a sign-in
                  or permission prompt, select your Shop Gmail and click <strong>Allow</strong>.
                </p>
              )}
              {showRo && (
                <p className="text-slate-800">
                  Neeche blue rang ka <strong>Execute</strong> button dabayein. Agar Google ijazat mange to apni Shop Gmail
                  chunein aur <strong>Allow / Continue</strong> kar dein.
                </p>
              )}
            </div>

            {/* Step 4 + Visual Example */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
              <p className="font-extrabold text-slate-900 text-sm">
                4. Copy only the digits after <code className="font-mono">people/</code>
              </p>
              {showEn && (
                <p className="text-slate-600">
                  In the green <code className="rounded bg-emerald-50 px-1 font-mono text-emerald-800">200</code> result,
                  copy only the long number after <strong>people/</strong>, paste it in Shop Settings, and click Save Policy.
                </p>
              )}
              {showRo && (
                <p className="text-slate-800">
                  Sabz rang ke <code className="rounded bg-emerald-50 px-1 font-mono text-emerald-800">200</code> jawab mein{' '}
                  <strong>people/</strong> ke baad likha hua lamba number copy karein, phir Settings mein paste karke{' '}
                  <strong>Save Policy Settings</strong> dabayein.
                </p>
              )}

              <div className="rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-slate-200 space-y-1">
                <div className="text-slate-400">{'// Result shown on Google page:'}</div>
                <div>
                  {'"resourceName": "people/'}
                  <span className="rounded bg-emerald-500/30 px-1 font-extrabold text-emerald-300 underline decoration-emerald-400">
                    118223344556677889900
                  </span>
                  {'"'}
                </div>
                <div className="pt-1 text-emerald-300 font-sans font-bold">
                  ✓ Copy this / Yeh copy karein: 118223344556677889900
                </div>
                <div className="text-rose-300 font-sans font-bold">
                  ✕ Do NOT paste / Yeh mat daalein: people/..., yourshop@gmail.com
                </div>
              </div>
            </div>
          </div>

          {/* Honest OS Limitation / Android 15+ Note */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-1.5 text-blue-950">
            <div className="flex items-center gap-2 font-extrabold text-blue-900">
              <ShieldCheck className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
              <span>Recovery-Mode Reset Protection & Device Limits</span>
            </div>
            {showEn && (
              <p>
                Android <strong>15+</strong> enforces Google&apos;s hardened Factory Reset Protection against repeated
                resets. Older phones (<strong>Android 8–10</strong> or older firmware) may only get legacy or weaker OEM
                protection — Almas SDM automatically verifies after every QR scan and raises an{' '}
                <strong className="inline-flex items-center gap-1 text-rose-700">
                  <ShieldAlert className="h-3 w-3 inline" aria-hidden="true" /> FRP Refused
                </strong>{' '}
                alert if a handset&apos;s OS drops the policy.
              </p>
            )}
            {showRo && (
              <p className={showEn ? 'border-t border-blue-200/80 pt-1.5' : ''}>
                <strong>Android 15</strong> aur naye phones mein Google ki sakht FRP protection hoti hai jo baar baar
                recovery reset par bhi lock pakka rakhti hai. Purane Android (<strong>8–10</strong> ya kuch purane ROMs)
                mein hifazat kamzor ho sakti hai — is liye hamara software har phone par khud check karke batata hai ke
                FRP waqai laga hai ya phone ke system ne inkaar (<strong>FRP Refused</strong>) kiya hai.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 shrink-0">
          {onGoToSettings && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onGoToSettings();
              }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-500"
            >
              Open Settings / Settings Kholein
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
          >
            Close / Band Karein
          </button>
        </div>
      </div>
    </div>
  );
};

