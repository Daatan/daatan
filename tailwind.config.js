/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // --- DAATAN COLOR SYSTEM ---
        // Single source of truth: edit globals.css :root variables only.

        // PRIMARY: Deep Navy
        navy: {
          900: 'var(--color-navy-900)',
          800: 'var(--color-navy-800)',
          700: 'var(--color-navy-700)',
          600: 'var(--color-navy-600)',
        },

        // SECONDARY: Cobalt Blue (actions, buttons, focus)
        cobalt: {
          DEFAULT: 'var(--color-cobalt)',
          hover:   'var(--color-cobalt-hover)',
          light:   'var(--color-cobalt-light)',
          soft:    'var(--color-cobalt-soft)',
        },

        // ACCENT: Analytical Teal (data, accuracy, results — use sparingly)
        teal: {
          DEFAULT: 'var(--color-teal)',
          hover:   'var(--color-teal-hover)',
          soft:    'var(--color-teal-soft)',
        },

        // NEUTRALS
        mist:             'var(--color-mist)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-subtle':    'var(--color-text-subtle)',

        // WCAG AA override: Tailwind's default gray-500 (#6B7280) and gray-600 (#4B5563)
        // fail contrast on the dark navy backgrounds used throughout this app.
        // Remapped to values that achieve ≥4.5:1 on navy-900 (#0B1F33).
        gray: {
          50:  '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF', // unchanged — already passes (~6.8:1)
          500: '#9AA5B4', // was #6B7280 (3.6:1) → now ~6.7:1 ✅
          600: '#7D8FA3', // was #4B5563 (2.3:1) → now ~5.1:1 ✅
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
          950: '#030712',
        },

        // Legacy alias kept for backward compat
        primary: 'var(--color-cobalt)',
        sidebar: {
          bg:     'var(--color-navy-900)',
          hover:  'var(--color-navy-800)',
          active: 'var(--color-navy-700)',
          text:   'var(--color-mist)',
          muted:  'var(--color-text-secondary)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-heebo)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
