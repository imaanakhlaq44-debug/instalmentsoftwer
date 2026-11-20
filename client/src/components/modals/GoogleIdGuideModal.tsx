import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
  Key,
  Laptop,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';

interface GoogleIdGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToSettings?: () => void;
}

type GuideLang = 'both' | 'roman' | 'en';

const GOOGLE_MAPS_URL = 'https://www.google.com/maps';
const EXAMPLE_ID = '118223344556677889900';

/**
 * The numeric Google Account ID inside a Google Maps "Your contributions"
 * link: https://www.google.com/maps/contrib/118223344556677889900/reviews…
 * Also accepts the bare number pasted on its own.
 */
export function extractGoogleAccountId(text: string): string | null {
  const trimmed = text.trim();
  const fromLink = trimmed.match(/contrib\/(\d{15,25})/);
  if (fromLink) return fromLink[1];
  const bare = trimmed.match(/^\d{15,25}$/);
  return bare ? bare[0] : null;
}

/**
 * How a shop finds its Google Account ID, the number Factory Reset Protection
 * needs.
 *
 * Google Maps shows it with no developer tools at all: the shop's own
 * "Your contributions" page has it in the address bar. So the guide is four
 * plain steps, the same on a computer and — with Chrome's "Desktop site"
 * switched on — on a phone, plus a box that pulls the number out of the link.
 */
export const GoogleIdGuideModal: React.FC<GoogleIdGuideModalProps> = ({
  isOpen,
  onClose,
  onGoToSettings,
}) => {
  const [lang, setLang] = useState<GuideLang>('both');
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);

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

  const foundId = pasted ? extractGoogleAccountId(pasted) : null;

  const copyId = (value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  /** One numbered step, in whichever languages are showing. */
  const step = (num: number, title: string, en: React.ReactNode, ro: React.ReactNode, extra?: React.ReactNode) => (
    <li className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-extrabold text-white">
        {num}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-extrabold text-slate-900">{title}</p>
        {showEn && <p className="text-slate-600">{en}</p>}
        {showRo && <p className="text-slate-800">{ro}</p>}
        {extra}
      </div>
    </li>
  );

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
                  ? 'How to Get Your Google Account ID'
                  : 'Google Account ID — 2 minute ka kaam'}
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
                <strong>Do NOT enter your Gmail address or phone number.</strong> Android needs the{' '}
                <strong>21-digit Google Account ID</strong> (example:{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">{EXAMPLE_ID}</code>). Use a
                separate <strong>Shop Gmail with 2-Step Verification ON</strong> — never your personal email.
              </p>
            )}
            {showRo && (
              <p className={showEn ? 'border-t border-amber-200/80 pt-1.5 text-amber-900' : ''}>
                <strong>Yahan @gmail.com ya phone number har giz mat likhein!</strong> Android sirf Google account ka{' '}
                <strong>21 hindson wala number ID</strong> qabool karta hai (misaal:{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono font-bold">{EXAMPLE_ID}</code>).
                Dukaan ke liye ek <strong>alag Shop Gmail</strong> banayein aur us par{' '}
                <strong>2-Step Verification ON</strong> rakhein — apna zati email na daalein.
              </p>
            )}
          </div>

          {/* Where to do it */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
              <p className="text-slate-700">
                <strong className="text-slate-900">Laptop / Computer:</strong>{' '}
                {showRo ? 'Google Chrome kholein aur seedha neeche wale steps karein.' : 'Open Google Chrome and follow the steps below.'}
              </p>
            </div>
            <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
              <p className="text-slate-700">
                <strong className="text-slate-900">Mobile:</strong>{' '}
                {showRo ? (
                  <>
                    Chrome kholein → upar <strong>⋮ (3 dots)</strong> → <strong>&ldquo;Desktop site&rdquo;</strong> par
                    tick lagayein. Phir yehi steps.
                  </>
                ) : (
                  <>
                    Open Chrome → <strong>⋮ (3 dots)</strong> → tick <strong>&ldquo;Desktop site&rdquo;</strong>. Then
                    the same steps.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* 4 Steps */}
          <ol className="space-y-2.5">
            {step(
              1,
              'Google Maps kholein / Open Google Maps',
              <>
                In Chrome, search <strong>Google Maps</strong> and open it. Make sure you are signed in with your{' '}
                <strong>Shop Gmail</strong>.
              </>,
              <>
                Chrome mein <strong>Google Maps</strong> search karke kholein. Check karein ke{' '}
                <strong>Dukaan wali Gmail</strong> se login hai.
              </>,
              <a
                href={GOOGLE_MAPS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-500"
              >
                Open Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {step(
              2,
              '3 dots → "Your contributions"',
              <>
                Click the <strong>⋮ (3 dots)</strong> / your profile picture at the <strong>top right</strong>, then
                click <strong>Your contributions</strong>.
              </>,
              <>
                <strong>Upar right side</strong> par <strong>⋮ (3 dots)</strong> / apni profile photo par click karein,
                phir <strong>&ldquo;Your contributions&rdquo;</strong> par click karein.
              </>
            )}
            {step(
              3,
              'URL se number copy karein / Copy the number from the URL',
              <>
                Look at the <strong>address bar</strong>. Copy only the long number that comes right after{' '}
                <code className="font-mono">contrib/</code>.
              </>,
              <>
                Upar <strong>address bar (URL)</strong> mein dekhein. <code className="font-mono">contrib/</code> ke
                baad jo lamba number hai, sirf woh copy karein.
              </>,
              <div className="mt-1 overflow-x-auto rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-slate-200">
                <span className="whitespace-nowrap">
                  google.com/maps/contrib/
                  <span className="rounded bg-emerald-500/30 px-1 font-extrabold text-emerald-300 underline decoration-emerald-400">
                    {EXAMPLE_ID}
                  </span>
                  /reviews
                </span>
                <div className="pt-1.5 font-sans font-bold text-emerald-300">
                  ✓ Copy this / Yeh copy karein: {EXAMPLE_ID}
                </div>
                <div className="font-sans font-bold text-rose-300">
                  ✕ Do NOT paste / Yeh mat daalein: contrib/..., yourshop@gmail.com
                </div>
              </div>
            )}
            {step(
              4,
              'Settings mein paste karein / Paste it in Settings',
              <>
                Paste the number in <strong>Settings → Google Account ID</strong> and click <strong>Save</strong>.
              </>,
              <>
                Number ko <strong>Settings → Google Account ID</strong> mein paste karein aur <strong>Save</strong>{' '}
                dabayein.
              </>
            )}
          </ol>

          {/* Paste helper */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-2">
            <label htmlFor="google-id-link" className="block text-sm font-extrabold text-slate-900">
              Pura link yahan paste karein — number hum nikal denge
            </label>
            {showEn && (
              <p className="text-slate-600">Not sure which part to copy? Paste the whole link and we&apos;ll pick out the ID.</p>
            )}
            <input
              id="google-id-link"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="https://www.google.com/maps/contrib/…"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            {pasted && foundId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
                <div>
                  <span className="block text-[11px] font-semibold text-emerald-700">Your Google Account ID</span>
                  <code className="font-mono text-sm font-extrabold text-emerald-900">{foundId}</code>
                </div>
                <button
                  type="button"
                  onClick={() => copyId(foundId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy ID
                    </>
                  )}
                </button>
              </div>
            )}
            {pasted && !foundId && (
              <p role="alert" className="font-semibold text-rose-700">
                Is link mein ID nahi mili. &ldquo;Your contributions&rdquo; page ka link copy karein (us mein{' '}
                <code className="font-mono">/contrib/</code> likha hota hai).
              </p>
            )}
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
