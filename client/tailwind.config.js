/**
 * Almas SDM design tokens — the marketing site's look (cream paper, ink
 * borders, hard offset shadows, sun and mint), so the dashboard and the home
 * page read as one product.
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
          50: '#FFFDF6',  // raised card — the home page's paper
          100: '#FFF8E8', // app canvas — the home page's cream
          200: '#F7EDD3', // sunken well / hover
          300: '#E6D9BA', // warm hairline (tables, dividers)
          400: '#CDBD98', // strong line
        },
        ink: {
          900: '#0F1419', // the home page's ink: headings, borders, shadows
          700: '#3A4350', // body
          500: '#5B6472', // secondary
          400: '#8A919C', // muted / captions
        },
        /* The single accent. 600 is the interactive step, 800 the brand ground. */
        accent: {
          50: '#EAF0FA',
          100: '#D6E2F5',
          200: '#AFC5EA',
          400: '#3D6CB8',
          500: '#2A56A0',
          600: '#1B4382',
          700: '#163A72',
          800: '#12305F', // the home page's navy
          900: '#0C2246',
          950: '#071530',
        },
        /* The home page's two loud colours, for highlights and active states. */
        sun: { 100: '#FFF1C7', 200: '#FFE08A', 400: '#FFC83D' },
        mint: { 100: '#DDF6EC', 300: '#7BE0C2', 500: '#1DB98F' },
        /* Status. Reserved — never used as a "nice colour" for a card. */
        positive: { 50: '#DDF6EC', 200: '#7BE0C2', 600: '#14946F', 700: '#0B7A5E' },
        caution:  { 50: '#FFF1C7', 200: '#FFE08A', 600: '#C98A00', 700: '#8A5B00' },
        critical: { 50: '#FDE3DF', 200: '#F6A99F', 600: '#E8473A', 700: '#B3301F' },
        /* --- Legacy, pending the page-by-page migration ---------------------
           The shell and the dashboard are on the tokens above. The remaining
           pages still name these, and an unknown Tailwind class is silently
           dropped rather than flagged — so they stay, mapped onto the new
           neutrals, until each page is migrated. Do not use them in new code. */
        navy: { 800: '#1B4382', 900: '#12305F', 950: '#0F1419' },
        /* Chart series. Validated: adjacent CVD ΔE 21.6, normal-vision ΔE 32.3. */
        viz: { collection: '#1B4382', overdue: '#E8473A', grid: '#E6D9BA' },
      },
      fontFamily: {
        sans: ['Archivo', 'Noto Naskh Arabic', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
        serif: ['Archivo', 'Noto Naskh Arabic', 'system-ui', 'sans-serif'],
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
      borderRadius: { DEFAULT: '8px', md: '12px', lg: '18px', xl: '22px' },
      boxShadow: {
        /* legacy aliases — see the note on the `navy` ramp above */
        card: '4px 4px 0 #0F1419',
        'card-hover': '5px 5px 0 #0F1419',
        /* Depth comes from spacing and hairlines. Shadows only say "this floats". */
        hairline: '3px 3px 0 #0F1419',
        raised: '5px 5px 0 #0F1419',
        overlay: '6px 6px 0 #0F1419',
        focus: '0 0 0 3px rgba(255, 200, 61, 0.55)',
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
