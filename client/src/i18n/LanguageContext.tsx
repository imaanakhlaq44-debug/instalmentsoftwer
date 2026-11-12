import React, { createContext, useContext, useEffect, useState } from 'react';
import { BIDI_MARKS, PageTranslator, toRomanUrdu, toUrdu } from './translate.js';

export type Language = 'en' | 'roman-ur' | 'ur';

const LANGUAGES: Language[] = ['en', 'roman-ur', 'ur'];

/** The last choice made on this browser: what the sign-in page opens in. */
const STORAGE_KEY = 'almas_language';
/** One person's own choice, so two people sharing a counter PC each keep theirs. */
const userKey = (userId: string) => `${STORAGE_KEY}:${userId}`;

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ language: 'en', setLanguage: () => {} });

function read(key: string): Language | null {
  try {
    const value = localStorage.getItem(key);
    return LANGUAGES.includes(value as Language) ? (value as Language) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: Language): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the choice lasts for this visit.
  }
}

/** What the document says about itself in each language. */
const DOCUMENT: Record<Language, { lang: string; dir: 'ltr' | 'rtl' }> = {
  en: { lang: 'en', dir: 'ltr' },
  'roman-ur': { lang: 'ur-Latn', dir: 'ltr' },
  ur: { lang: 'ur', dir: 'rtl' },
};

/**
 * Text copied off an Urdu page carries the invisible direction marks that keep
 * numbers in order. Pasted into the search box, an IMEI with those in it would
 * match nothing, so they are taken out on the way to the clipboard.
 */
function copyWithoutMarks(event: ClipboardEvent): void {
  const selected = window.getSelection()?.toString() ?? '';
  if (!selected || !event.clipboardData) return;
  const clean = selected.replace(BIDI_MARKS, '');
  if (clean === selected) return;
  event.clipboardData.setData('text/plain', clean);
  event.preventDefault();
}

/**
 * The choice of English, Roman Urdu or Urdu, remembered for each person who
 * signs in on this browser.
 *
 * The translation is applied to the rendered page rather than threaded through
 * every component, so every screen, modal and toast is covered without each one
 * having to know about it. Urdu also turns the document right-to-left.
 */
export const LanguageProvider: React.FC<{ userId?: string | null; children: React.ReactNode }> = ({
  userId,
  children,
}) => {
  const [language, setLanguageState] = useState<Language>(
    () => (userId ? read(userKey(userId)) : null) ?? read(STORAGE_KEY) ?? 'en'
  );

  // Someone signed in: use what they chose last time, if they ever chose.
  useEffect(() => {
    if (!userId) return;
    const own = read(userKey(userId));
    if (own) setLanguageState(own);
  }, [userId]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = DOCUMENT[language].lang;
    root.dir = DOCUMENT[language].dir;
    if (language === 'en') return;

    const translator = new PageTranslator(language === 'ur' ? toUrdu : toRomanUrdu);
    translator.start();
    if (language === 'ur') document.addEventListener('copy', copyWithoutMarks);
    return () => {
      translator.stop();
      document.removeEventListener('copy', copyWithoutMarks);
    };
  }, [language]);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    write(STORAGE_KEY, next);
    if (userId) write(userKey(userId), next);
  };

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => useContext(LanguageContext);

/** English / Roman Urdu / اردو switch for the top bar. */
export const LanguageToggle: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const option = (value: Language, label: React.ReactNode, name: string) => (
    <button
      type="button"
      onClick={() => setLanguage(value)}
      aria-pressed={language === value}
      aria-label={name}
      lang={DOCUMENT[value].lang}
      className={`px-2 py-1 text-caption font-extrabold transition-colors sm:px-2.5 ${
        language === value ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-sun-100'
      }`}
    >
      {label}
    </button>
  );
  return (
    // Left as written in every language, and always in the same order, so the
    // way back is readable and stays where it was.
    <div
      data-i18n-skip
      dir="ltr"
      role="group"
      aria-label="Language"
      className="flex shrink-0 overflow-hidden rounded-md border-2 border-ink-900 bg-white"
    >
      {option(
        'en',
        <>
          <span className="sm:hidden">EN</span>
          <span className="hidden sm:inline">English</span>
        </>,
        'English'
      )}
      {option(
        'roman-ur',
        <>
          <span className="sm:hidden">Roman</span>
          <span className="hidden sm:inline">Roman Urdu</span>
        </>,
        'Roman Urdu'
      )}
      {option('ur', 'اردو', 'اردو')}
    </div>
  );
};
