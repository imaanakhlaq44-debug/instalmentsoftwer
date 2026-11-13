import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';

import { HANDSET_TEST_STEPS } from '../utils/handsetTest.js';
import { toRomanUrdu, toUrdu } from '../i18n/translate.js';

/**
 * The phone test checklist on paper, for the counter.
 *
 * One fixed A4 sheet in English, Roman Urdu and Urdu side by side, whatever
 * language the dashboard is in. The step texts come from `HANDSET_TEST_STEPS`
 * and their translations from the dashboard dictionaries, so the sheet never
 * drifts from the on-screen checklist.
 */

const HEADER_FIELDS = ['Brand', 'Model', 'Android version', 'Lock app version', 'Tester', 'Date'];
const RESULTS = ['Pass', 'Fail', 'Not tested'];
const BEFORE_YOU_START = [
  'Factory reset the phone first.',
  'Connect the phone to Wi-Fi.',
  'Open QR Enrollment on the dashboard and keep its QR ready to scan.',
  'The location step needs lock app version 1.5.2 or newer.',
];
const TITLE = 'Phone test checklist';
const INTRO = 'Tick one box for each step. Write what you saw on the note line.';

/** Every English line the sheet prints; each needs a Roman Urdu and an Urdu entry. */
export const CHECKLIST_SHEET_TEXT: ReadonlyArray<string> = [
  TITLE, INTRO, 'Before you start', 'Note', ...HEADER_FIELDS, ...RESULTS, ...BEFORE_YOU_START,
  ...HANDSET_TEST_STEPS.flatMap((s) => [s.title, s.how]),
];

/** A short label in all three languages, the same word printed once. */
const short = (en: string) => [...new Set([en, toRomanUrdu(en)])].join(' / ');

const Urdu: React.FC<{ children: string; className?: string }> = ({ children, className = '' }) => (
  <span dir="rtl" lang="ur" className={`hc-ur ${className}`}>{toUrdu(children)}</span>
);

const Box: React.FC<{ label: string }> = ({ label }) => (
  <span className="hc-box-item">
    <span className="hc-box" aria-hidden="true" />
    <span>{short(label)}</span> <Urdu>{label}</Urdu>
  </span>
);

export const HandsetTestChecklist: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="hc-overlay fixed inset-0 z-50 overflow-auto bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={TITLE}>
      {/* A4 rules live here, not in index.css, which sizes pages for receipt rolls. */}
      <style>{`
        .hc-sheet { font-size: 10px; line-height: 1.35; color: #111; }
        .hc-sheet h1 { font-size: 16px; font-weight: 700; }
        .hc-ur { font-family: 'Jameel Noori Nastaleeq', 'Noto Nastaliq Urdu', serif; display: block; text-align: right; line-height: 1.9; }
        .hc-cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .hc-step { border: 1px solid #999; border-radius: 4px; padding: 6px 8px; break-inside: avoid; page-break-inside: avoid; }
        .hc-boxes { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; margin-top: 4px; }
        .hc-box-item { display: inline-flex; align-items: center; gap: 4px; }
        .hc-box-item .hc-ur { display: inline; }
        .hc-box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #111; }
        .hc-line { display: block; border-bottom: 1px solid #555; min-height: 18px; }
        @media print {
          @page { size: A4; margin: 10mm; }
          body * { visibility: hidden; }
          #printable-handset-checklist, #printable-handset-checklist * { visibility: visible; }
          .hc-overlay { position: absolute !important; inset: 0 auto auto 0 !important; overflow: visible !important; padding: 0 !important; background: none !important; width: 100%; }
          #printable-handset-checklist { position: absolute; top: 0; left: 0; width: 100%; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] print:hidden mb-3 flex justify-end gap-2">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      <div
        id="printable-handset-checklist"
        className="hc-sheet mx-auto max-w-[210mm] bg-white p-[10mm] shadow-xl space-y-3"
        data-i18n-skip dir="ltr" lang="en"
      >
        <header>
          <h1>{short(TITLE)}</h1>
          <Urdu className="text-sm font-bold">{TITLE}</Urdu>
          <p>{INTRO} — {toRomanUrdu(INTRO)}</p>
          <Urdu>{INTRO}</Urdu>
        </header>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {HEADER_FIELDS.map((f) => (
            <div key={f} className="flex items-end gap-2">
              <span className="whitespace-nowrap font-semibold">{short(f)}</span>
              <span className="hc-ur !inline whitespace-nowrap">{toUrdu(f)}</span>
              <span className="hc-line flex-1" />
            </div>
          ))}
        </div>

        <section className="hc-step" style={{ borderWidth: 2 }}>
          <p className="font-bold">{short('Before you start')} <Urdu className="!inline">{'Before you start'}</Urdu></p>
          <ul className="hc-cols mt-1">
            {[(t: string) => t, toRomanUrdu, toUrdu].map((fn, col) => (
              <li key={col} className="list-none space-y-0.5" dir={col === 2 ? 'rtl' : undefined} lang={col === 2 ? 'ur' : undefined}>
                {BEFORE_YOU_START.map((line) => (
                  <span key={line} className={col === 2 ? 'hc-ur' : 'block'}>• {fn(line)}</span>
                ))}
              </li>
            ))}
          </ul>
        </section>

        <ol className="space-y-2">
          {HANDSET_TEST_STEPS.map((step, i) => (
            <li key={step.key} className="hc-step" data-testid="checklist-step">
              <div className="hc-cols">
                <div>
                  <p className="font-bold">{i + 1}. {step.title}</p>
                  <p>{step.how}</p>
                </div>
                <div>
                  <p className="font-bold">{i + 1}. {toRomanUrdu(step.title)}</p>
                  <p>{toRomanUrdu(step.how)}</p>
                </div>
                <div dir="rtl" lang="ur">
                  <span className="hc-ur font-bold">{i + 1}. {toUrdu(step.title)}</span>
                  <span className="hc-ur">{toUrdu(step.how)}</span>
                </div>
              </div>
              <div className="hc-boxes">
                {RESULTS.map((r) => <Box key={r} label={r} />)}
              </div>
              <div className="mt-1 flex items-end gap-2">
                <span className="font-semibold whitespace-nowrap">{short('Note')}</span>
                <span className="hc-ur !inline">{toUrdu('Note')}</span>
                <span className="hc-line flex-1" />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};
