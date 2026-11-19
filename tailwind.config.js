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
        // Every entry must be `rgb(var(--color-X-rgb) / <alpha-value>)`. A bare `var(--color-X)`
        // silently drops all opacity variants (`bg-cobalt/10`, `border-navy-600/50`) from the
        // build (#2253); src/lib/__tests__/tailwind-colors.test.ts enforces this.

        // PRIMARY: Deep Navy
        navy: {
          900: 'rgb(var(--color-navy-900-rgb) / <alpha-value>)',
          800: 'rgb(var(--color-navy-800-rgb) / <alpha-value>)',
          700: 'rgb(var(--color-navy-700-rgb) / <alpha-value>)',
          600: 'rgb(var(--color-navy-600-rgb) / <alpha-value>)',
        },

        // SECONDARY: Cobalt Blue (actions, buttons, focus)
        cobalt: {
          DEFAULT: 'rgb(var(--color-cobalt-rgb) / <alpha-value>)',
          hover:   'rgb(var(--color-cobalt-hover-rgb) / <alpha-value>)',
          light:   'rgb(var(--color-cobalt-light-rgb) / <alpha-value>)',
          soft:    'rgb(var(--color-cobalt-soft-rgb) / <alpha-value>)',
        },

        // ACCENT: Analytical Teal (data, accuracy, results — use sparingly)
        teal: {
          DEFAULT: 'rgb(var(--color-teal-rgb) / <alpha-value>)',
          hover:   'rgb(var(--color-teal-hover-rgb) / <alpha-value>)',
          soft:    'rgb(var(--color-teal-soft-rgb) / <alpha-value>)',
        },

        // NEUTRALS
        mist:             'rgb(var(--color-mist-rgb) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',
        'text-subtle':    'rgb(var(--color-text-subtle-rgb) / <alpha-value>)',

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
        primary: 'rgb(var(--color-cobalt-rgb) / <alpha-value>)',
        sidebar: {
          bg:     'rgb(var(--color-navy-900-rgb) / <alpha-value>)',
          hover:  'rgb(var(--color-navy-800-rgb) / <alpha-value>)',
          active: 'rgb(var(--color-navy-700-rgb) / <alpha-value>)',
          text:   'rgb(var(--color-mist-rgb) / <alpha-value>)',
          muted:  'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-heebo)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
