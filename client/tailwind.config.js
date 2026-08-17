/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f5ff',
          100: '#e0ecff',
          200: '#b9d5ff',
          300: '#7cb2ff',
          400: '#3888ff',
          500: '#0059e6',
          600: '#0043b8',
          700: '#00338f',
          800: '#0b192c',
          900: '#07101e',
          950: '#03080f',
        },
        navy: {
          800: '#0f172a',
          900: '#0B192C',
          950: '#060D17',
        },
        status: {
          active: '#059669', // emerald
          pending: '#D97706', // amber
          overdue: '#EA580C', // orange-red
          locked: '#DC2626', // red
          unlocked: '#2563EB', // royal blue
          inactive: '#64748B', // slate
        }
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'card-hover': '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
        'premium': '0 20px 25px -5px rgba(11, 25, 44, 0.08), 0 8px 10px -6px rgba(11, 25, 44, 0.04)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
