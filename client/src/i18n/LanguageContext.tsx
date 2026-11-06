import React, { createContext, useContext, useEffect, useState } from 'react';
import { PageTranslator } from './translate.js';

export type Language = 'en' | 'roman-ur';

const STORAGE_KEY = 'almas_language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ language: 'en', setLanguage: () => {} });

function stored(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'roman-ur' ? 'roman-ur' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * The shop's choice of English or Roman Urdu, remembered on this browser.
 *
 * Roman Urdu is applied to the rendered page rather than threaded through every
 * component, so every screen, modal and toast is covered without each one
 * having to know about it.
 */
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(stored);

  useEffect(() => {
    document.documentElement.lang = language === 'roman-ur' ? 'ur-Latn' : 'en';
    if (language !== 'roman-ur') return;
    const translator = new PageTranslator();
    translator.start();
    return () => translator.stop();
  }, [language]);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private window or blocked storage: the choice lasts for this visit.
    }
  };

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => useContext(LanguageContext);

/** English / Roman Urdu switch for the top bar. */
export const LanguageToggle: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const option = (value: Language, label: string) => (
    <button
      type="button"
      onClick={() => setLanguage(value)}
      aria-pressed={language === value}
      className={`px-2.5 py-1 text-caption font-extrabold transition-colors ${
        language === value ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-sun-100'
      }`}
    >
      {label}
    </button>
  );
  return (
    // Left as written in both languages, so the way back is always readable.
    <div
      data-i18n-skip
      role="group"
      aria-label="Language"
      className="flex shrink-0 overflow-hidden rounded-md border-2 border-ink-900 bg-white"
    >
      {option('en', 'English')}
      {option('roman-ur', 'Roman Urdu')}
    </div>
  );
};
