// @vitest-environment node
/**
 * Brand colours must keep their Tailwind opacity variants (#2253).
 *
 * The colours in tailwind.config.js come from CSS variables in globals.css. Written as a bare
 * `var(--color-cobalt)`, Tailwind 3 cannot apply an opacity modifier and silently emits no rule
 * for `bg-cobalt/10`, `border-navy-600/50` etc. — 102 uses rendered transparent or with the
 * near-white default border for months. Each colour is now RGB channels plus `<alpha-value>`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import type { Config } from 'tailwindcss'
import tailwindConfig from '../../../tailwind.config.js'

const config = tailwindConfig as Config
const globalsCss = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf-8')

function flatten(colors: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(colors).flatMap(([key, value]) => {
    const name = key === 'DEFAULT' ? prefix : prefix ? `${prefix}-${key}` : key
    return typeof value === 'string' ? [[name, value] as [string, string]] : flatten(value as Record<string, unknown>, name)
  })
}

const colors = flatten((config.theme?.extend?.colors ?? {}) as Record<string, unknown>)
const varColors = colors.filter(([, value]) => value.includes('var('))

describe('tailwind brand colours', () => {
  it('has the CSS-variable colours this test is about', () => {
    expect(varColors.map(([name]) => name)).toEqual(expect.arrayContaining(['navy-600', 'cobalt', 'teal', 'text-secondary']))
  })

  it.each(varColors)('%s takes an opacity modifier (rgb channels + <alpha-value>)', (_name, value) => {
    expect(value).toMatch(/^rgb\(var\(--color-[\w-]+-rgb\) \/ <alpha-value>\)$/)
  })

  it.each(varColors)('%s points at channels defined in globals.css', (_name, value) => {
    const varName = value.match(/--color-[\w-]+-rgb/)![0]
    expect(globalsCss).toMatch(new RegExp(`${varName}:\\s*\\d{1,3} \\d{1,3} \\d{1,3};`))
  })

  it('keeps the plain --color-X names, derived from the channels, for direct var() users', () => {
    // layout.tsx (toasts) and the scrollbar rules use var(--color-navy-700) etc. directly.
    for (const [, value] of varColors) {
      const base = value.match(/--color-([\w-]+)-rgb/)![1]
      expect(globalsCss).toContain(`--color-${base}:`)
      expect(globalsCss).toMatch(new RegExp(`--color-${base}:\\s*rgb\\(var\\(--color-${base}-rgb\\)\\);`))
    }
  })

  it('generates opacity variants, and plain classes keep full opacity', async () => {
    const raw = 'bg-cobalt/10 border-navy-600/50 bg-navy-900/90 text-text-secondary/80 bg-teal/10 bg-navy-900'
    const { css } = await postcss([
      tailwindcss({ ...config, content: [{ raw, extension: 'html' }], corePlugins: { preflight: false } }),
    ]).process('@tailwind utilities;', { from: undefined })

    expect(css).toMatch(/\.bg-cobalt\\\/10\s*\{\s*background-color: rgb\(var\(--color-cobalt-rgb\) \/ 0\.1\)/)
    expect(css).toMatch(/\.border-navy-600\\\/50\s*\{\s*border-color: rgb\(var\(--color-navy-600-rgb\) \/ 0\.5\)/)
    expect(css).toMatch(/\.bg-navy-900\\\/90\s*\{/)
    expect(css).toMatch(/\.text-text-secondary\\\/80\s*\{/)
    expect(css).toMatch(/\.bg-teal\\\/10\s*\{/)
    expect(css).toMatch(/\.bg-navy-900\s*\{\s*--tw-bg-opacity: 1;\s*background-color: rgb\(var\(--color-navy-900-rgb\) \/ var\(--tw-bg-opacity, 1\)\)/)
  })
})
