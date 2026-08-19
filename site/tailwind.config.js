/**
 * The marketing site borrows the product's design tokens rather than redefining
 * them. A prospect who signs up should land in an application that looks like
 * the site that sold it to them — and a colour that only exists in one of the
 * two places is a colour that will drift.
 */
import dashboard from '../client/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.html', './build.mjs'],
  theme: {
    extend: {
      ...dashboard.theme.extend,
      fontFamily: {
        ...dashboard.theme.extend.fontFamily,
        /** Urdu is set in Naskh: Nastaliq is beautiful and unreadable at 14px. */
        urdu: ['Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'serif'],
      },
      fontSize: {
        ...dashboard.theme.extend.fontSize,
        /** The site needs two sizes above anything the dashboard ever shows. */
        hero: ['2.75rem', { lineHeight: '3rem', letterSpacing: '-0.03em' }],
        section: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
      },
    },
  },
  plugins: [],
};
