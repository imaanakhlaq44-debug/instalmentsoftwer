/**
 * Almas SDM design tokens.
 *
 * The rules this file encodes, so they survive the next feature:
 *
 *   1. Colour carries meaning, never decoration. There is ONE accent (ink-blue),
 *      and three status hues — positive, caution, critical — and nothing else.
 *      A card is not blue because it is a card; it is blue because it is a link.
 *   2. Neutrals are warm. A pure-grey UI reads clinical on the cheap panels these
 *      shops actually own; a paper-warm one stays readable under tube light.
 *   3. Three radii, four shadows, one 8px spacing rhythm. Anything else is drift.
 *   4. Chart hues are separate tokens (`viz`) and were validated for colour-vision
 *      deficiency — do not reach for them as UI colours, or for chart colours use
 *      anything else.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Modern crisp neutral ramp — sleek SaaS surface language */
        paper: {
          50: '#FFFFFF',  // raised card
          100: '#F8FAFC', // app canvas
          200: '#F1F5F9', // sunken well / hover
          300: '#E2E8F0', // crisp hairline border
          400: '#CBD5E1', // strong border
        },
        ink: {
          900: '#0F172A', // crisp dark headings
          700: '#334155', // clear readable body
          500: '#64748B', // secondary
          400: '#94A3B8', // muted / captions
        },
        /* The single accent. 600 is the interactive step, 800 the brand ground. */
        accent: {
          50: '#EEF4FD',
          100: '#DCE8FA',
          200: '#B7D3F6',
          400: '#3987E5',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
          800: '#1E3A8A',
          900: '#172554',
          950: '#0A1329',
        },
        /* Status. Reserved — never used as a "nice colour" for a card. */
        positive: { 50: '#ECFDF5', 200: '#A7F3D0', 600: '#059669', 700: '#047857' },
        caution:  { 50: '#FFFBEB', 200: '#FDE68A', 600: '#D97706', 700: '#B45309' },
        critical: { 50: '#FEF2F2', 200: '#FECACA', 600: '#DC2626', 700: '#B91C1C' },
        /* --- Legacy, pending the page-by-page migration ---------------------
           The shell and the dashboard are on the tokens above. The remaining
           pages still name these, and an unknown Tailwind class is silently
           dropped rather than flagged — so they stay, mapped onto the new
           neutrals, until each page is migrated. Do not use them in new code. */
        navy: { 800: '#1E293B', 900: '#0F172A', 950: '#020617' },
        /* Chart series. Validated: adjacent CVD ΔE 21.6, normal-vision ΔE 32.3. */
        viz: { collection: '#2563EB', overdue: '#DC2626', grid: '#E2E8F0' },
      },
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', 'Noto Naskh Arabic', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Plus Jakarta Sans', 'Noto Naskh Arabic', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        /* A real scale, so a heading is a heading everywhere. */
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        caption: ['0.75rem', { lineHeight: '1.125rem' }],
        body: ['0.875rem', { lineHeight: '1.375rem' }],
        lede: ['1rem', { lineHeight: '1.5rem' }],
        title: ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        display: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
        figure: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.03em' }],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '12px', xl: '16px' },
      boxShadow: {
        /* legacy aliases — see the note on the `navy` ramp above */
        card: '0 1px 2px rgba(23, 22, 20, 0.04)',
        'card-hover': '0 2px 8px rgba(23, 22, 20, 0.06)',
        /* Depth comes from spacing and hairlines. Shadows only say "this floats". */
        hairline: '0 1px 2px rgba(23, 22, 20, 0.04)',
        raised: '0 2px 8px rgba(23, 22, 20, 0.06)',
        overlay: '0 12px 32px -8px rgba(23, 22, 20, 0.16)',
        focus: '0 0 0 3px rgba(37, 106, 191, 0.18)',
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
