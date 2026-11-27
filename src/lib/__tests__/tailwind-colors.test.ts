// @vitest-environment node
/**
 * Brand colours must keep their Tailwind opacity variants (#2253).
 *
 * Under Tailwind 3 the brand colours were bare `var(--color-cobalt)` values, which cannot
 * take an opacity modifier: `bg-cobalt/10`, `border-navy-600/50` etc. emitted no rule, and
 * 102 uses rendered transparent or with the near-white default border for months.
 *
 * Since Tailwind 4 (#2355) the theme lives in globals.css (`@theme`), and opacity variants
 * are built with color-mix(). This test compiles the real globals.css with Tailwind and
 * checks the generated rules, so a theme edit that breaks the variants fails here.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const root = path.resolve(__dirname, '../../..')
const globalsPath = path.join(root, 'src/app/globals.css')
const globalsCss = readFileSync(globalsPath, 'utf-8')

const CANDIDATES = [
  'bg-cobalt/10', 'border-navy-600/50', 'bg-navy-900/90', 'text-text-secondary/80', 'bg-teal/10',
  'bg-navy-900', 'text-gray-500', 'font-sans', 'hover:bg-cobalt', 'text-xs', 'md:text-lg',
  'bg-blue-600', 'text-green-400', 'bg-rose-500/50',
]

/** The body of the first rule whose selector is exactly `.<className>` (escaped), braces balanced. */
function ruleBody(css: string, className: string): string | null {
  const selector = '.' + className.replace(/[/:]/g, (c) => '\\' + c)
  const start = css.indexOf(selector + ' {')
  if (start === -1) return null
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return null
}

/** `--color-X: rgb(var(--color-X-rgb))` entries of the @theme block: [X, channel var name]. */
function themeChannelColours(): [string, string][] {
  const theme = globalsCss.match(/@theme\s*\{([\s\S]*?)\n\}/)
  if (!theme) throw new Error('no @theme block in globals.css')
  return [...theme[1].matchAll(/--color-([\w-]+):\s*rgb\(var\((--color-[\w-]+-rgb)\)\);/g)].map((m) => [m[1], m[2]])
}

let css = ''

beforeAll(async () => {
  // Compile only the candidates above instead of scanning the repo for class names.
  const importLine = "@import 'tailwindcss';"
  expect(globalsCss.split(importLine)).toHaveLength(2)
  const input = globalsCss.replace(
    importLine,
    `@import 'tailwindcss' source(none);\n@source inline("${CANDIDATES.join(' ')}");`,
  )
  const result = await postcss([tailwindcss({ base: root, optimize: false })]).process(input, { from: globalsPath })
  css = result.css
}, 30_000)

describe('tailwind brand colours', () => {
  it('maps the brand colours in @theme to RGB channel variables', () => {
    expect(themeChannelColours().map(([name]) => name)).toEqual(
      expect.arrayContaining(['navy-600', 'navy-900', 'cobalt', 'teal', 'text-secondary']),
    )
  })

  it.each(themeChannelColours())('%s points at channels defined in globals.css', (_name, channelVar) => {
    expect(globalsCss).toMatch(new RegExp(`${channelVar}:\\s*\\d{1,3} \\d{1,3} \\d{1,3};`))
  })

  it('keeps the plain --color-X names, derived from the channels, for direct var() users', () => {
    // layout.tsx (toasts) and the scrollbar rules use var(--color-navy-700) etc. directly.
    for (const [, channelVar] of themeChannelColours()) {
      const base = channelVar.match(/^--color-([\w-]+)-rgb$/)![1]
      expect(globalsCss).toMatch(new RegExp(`--color-${base}:\\s*rgb\\(var\\(--color-${base}-rgb\\)\\);`))
    }
  })

  it.each([
    ['bg-cobalt/10', 'background-color', 'cobalt', '10%'],
    ['border-navy-600/50', 'border-color', 'navy-600', '50%'],
    ['bg-navy-900/90', 'background-color', 'navy-900', '90%'],
    ['text-text-secondary/80', 'color', 'text-secondary', '80%'],
    ['bg-teal/10', 'background-color', 'teal', '10%'],
  ])('generates %s with the brand colour at that opacity', (cls, property, colour, pct) => {
    const body = ruleBody(css, cls)
    expect(body, `no rule for .${cls}`).not.toBeNull()
    const mix = new RegExp(
      `${property}: color-mix\\(in \\w+, (?:var\\(--color-${colour}\\)|rgb\\(var\\(--color-${colour}-rgb\\)\\)) ${pct}, transparent\\)`,
    )
    expect(body).toMatch(mix)
  })

  it('keeps plain brand classes at full opacity', () => {
    expect(ruleBody(css, 'bg-navy-900')).toMatch(/^\s*background-color: var\(--color-navy-900\);\s*$/)
  })

  it('keeps the contrast-safe gray-500 override', () => {
    expect(ruleBody(css, 'text-gray-500')).toMatch(/color: var\(--color-gray-500\)/)
    expect(css).toMatch(/--color-gray-500: #9aa5b4;/)
  })
})

describe('Tailwind 3 behaviour kept after the v4 upgrade (#2355)', () => {
  it('resolves the font stack where next/font defines its variables, not at :root', () => {
    expect(ruleBody(css, 'font-sans')).toMatch(/font-family: var\(--font-inter\), var\(--font-heebo\), system-ui, sans-serif;/)
  })

  it('applies hover: on touch screens too (not gated on @media (hover: hover))', () => {
    expect(css).toContain('hover\\:bg-cobalt')
    expect(css).not.toContain('@media (hover: hover)')
  })

  it('keeps v3 line heights in rem, so a child with its own font size does not inherit a ratio', () => {
    expect(css).toMatch(/--text-xs--line-height: 1rem;/)
    expect(css).toMatch(/--text-lg--line-height: 1\.75rem;/)
  })

  it('keeps the v3 gray-200 default border colour instead of currentColor', () => {
    expect(css).toMatch(/::file-selector-button\s*\{\s*border-color: var\(--color-gray-200, currentcolor\);/)
  })

  it('keeps the v3 default palette in hex instead of v4 oklch', () => {
    const palette = readFileSync(path.join(root, 'src/app/tailwind-v3-palette.css'), 'utf-8')
    const values = [...palette.matchAll(/--color-([a-z]+)-(\d+): (#[0-9a-f]{6});/g)]
    expect(new Set(values.map((m) => m[1])).size).toBe(21)
    expect(values).toHaveLength(21 * 11)
    expect(palette).not.toMatch(/:\s*oklch\(/)
    expect(css).toMatch(/--color-blue-600: #2563eb;/)
    expect(css).toMatch(/--color-green-400: #4ade80;/)
    expect(ruleBody(css, 'bg-rose-500/50')).toMatch(/color-mix\(in \w+, var\(--color-rose-500\) 50%, transparent\)/)
    expect(css).toMatch(/--color-rose-500: #f43f5e;/)
  })

  it('keeps the v3 placeholder colour and button cursor', () => {
    expect(css).toMatch(/input::placeholder,\s*textarea::placeholder\s*\{\s*color: var\(--color-gray-400\);/)
    expect(css).toMatch(/button:not\(:disabled\),\s*\[role='button'\]:not\(:disabled\)\s*\{\s*cursor: pointer;/)
  })
})
