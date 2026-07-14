/**
 * i18n completeness tests
 *
 * 1. Key parity — en.json and he.json must have identical key sets.
 *    Prevents a translation being added in one locale but forgotten in another.
 *
 * 2. Source coverage — every static t('key') call paired with a
 *    useTranslations('namespace') in source files must resolve to a real key
 *    in en.json. Prevents MISSING_MESSAGE console errors at runtime.
 *
 * 3. ICU validity — every message in every locale must parse as ICU. Key parity
 *    alone cannot catch a malformed plural (e.g. a missing `other` clause),
 *    which throws only when the string is actually rendered.
 *
 * 4. Placeholder parity — a translation must carry the same {placeholders} as
 *    its English source, so no locale silently drops an interpolated value.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { IntlMessageFormat } from 'intl-messageformat'
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, '../..')

function loadJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/** Flatten a nested object to dot-notation keys: { a: { b: 1 } } → ['a.b'] */
function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatKeys(v as Record<string, unknown>, full)
      : [full]
  })
}

/** Read all .ts/.tsx source files under src/ recursively */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) return [full]
    return []
  })
}

// ─── Load message files ───────────────────────────────────────────────────────

const en = loadJson(join(ROOT, 'messages/en.json'))
const he = loadJson(join(ROOT, 'messages/he.json'))
const ru = loadJson(join(ROOT, 'messages/ru.json'))
const eo = loadJson(join(ROOT, 'messages/eo.json'))
const enKeys = new Set(flatKeys(en))
const heKeys = new Set(flatKeys(he))
const ruKeys = new Set(flatKeys(ru))
const eoKeys = new Set(flatKeys(eo))

// ─── Test 1: Key parity ───────────────────────────────────────────────────────

describe('i18n key parity (en ↔ he ↔ ru ↔ eo)', () => {
  it('en.json has no keys missing from he.json', () => {
    const missing = [...enKeys].filter(k => !heKeys.has(k))
    expect(missing, `Keys in en.json but missing from he.json:\n${missing.join('\n')}`).toEqual([])
  })

  it('en.json has no keys missing from ru.json', () => {
    const missing = [...enKeys].filter(k => !ruKeys.has(k))
    expect(missing, `Keys in en.json but missing from ru.json:\n${missing.join('\n')}`).toEqual([])
  })

  it('en.json has no keys missing from eo.json', () => {
    const missing = [...enKeys].filter(k => !eoKeys.has(k))
    expect(missing, `Keys in en.json but missing from eo.json:\n${missing.join('\n')}`).toEqual([])
  })

  it('he.json has no keys missing from en.json', () => {
    const extra = [...heKeys].filter(k => !enKeys.has(k))
    expect(extra, `Keys in he.json but missing from en.json:\n${extra.join('\n')}`).toEqual([])
  })

  it('ru.json has no keys missing from en.json', () => {
    const extra = [...ruKeys].filter(k => !enKeys.has(k))
    expect(extra, `Keys in ru.json but missing from en.json:\n${extra.join('\n')}`).toEqual([])
  })

  it('eo.json has no keys missing from en.json', () => {
    const extra = [...eoKeys].filter(k => !enKeys.has(k))
    expect(extra, `Keys in eo.json but missing from en.json:\n${extra.join('\n')}`).toEqual([])
  })
})

// ─── Test 2: Source coverage ──────────────────────────────────────────────────

/**
 * Extract all static translator('key') calls from a source file.
 * Maps each const variable assigned from useTranslations('ns') to its
 * namespace, then matches variable('key') call sites.
 *
 * Handles files with multiple translators:
 *   const t = useTranslations('forecast')
 *   const c = useTranslations('common')
 *   t('deadline') → forecast.deadline
 *   c('loading')  → common.loading
 *
 * Limitations (acceptable):
 * - Dynamic keys like t(variable) or t(`${x}`) are skipped.
 */
function extractTranslationUsages(source: string): { namespace: string; key: string }[] {
  // Build variable → namespace map
  const varToNs = new Map<string, string>()
  const nsRe = /const\s+(\w+)\s*=\s*useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = nsRe.exec(source)) !== null) varToNs.set(m[1], m[2])
  if (varToNs.size === 0) return []

  const usages: { namespace: string; key: string }[] = []
  // Match varName('key') — varName must be one of our translator variables
  const varPattern = [...varToNs.keys()].join('|')
  const tRe = new RegExp(`\\b(${varPattern})\\(\\s*'([^']+)'\\s*\\)`, 'g')
  while ((m = tRe.exec(source)) !== null) {
    const [, varName, key] = m
    // Skip keys that look like test strings or punctuation
    if (/^[\s.,!?:;/\\0-9%+\-]/.test(key)) continue
    usages.push({ namespace: varToNs.get(varName)!, key })
  }
  return usages
}

// ─── Test 3: ICU validity ─────────────────────────────────────────────────────

/** Flatten to dot-notation entries, keeping the string values. */
function flatEntries(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return flatEntries(v as Record<string, unknown>, full)
    }
    return typeof v === 'string' ? ([[full, v]] as [string, string][]) : []
  })
}

const LOCALES: [string, Record<string, unknown>][] = [
  ['en', en],
  ['he', he],
  ['ru', ru],
  ['eo', eo],
]

describe('i18n ICU validity', () => {
  it.each(LOCALES)('every message in %s.json parses as ICU', (locale, messages) => {
    const broken: string[] = []
    for (const [key, value] of flatEntries(messages)) {
      try {
        // Construction parses the message; it does not require format() args,
        // so rich-text messages (<b>…</b>) are fine here.
        new IntlMessageFormat(value, locale)
      } catch (err) {
        broken.push(`  ${key}: ${(err as Error).message.split('\n')[0]}`)
      }
    }
    expect(broken, `Unparseable ICU messages in ${locale}.json:\n${broken.join('\n')}`).toEqual([])
  })
})

// ─── Test 4: Placeholder parity ───────────────────────────────────────────────

/**
 * Every argument name referenced by a message, read off the ICU AST rather than
 * by regex — a plural branch can itself contain further placeholders
 * ("{count, plural, ...} · {cu} CU"), which brace-matching by hand gets wrong.
 */
function placeholders(message: string): string[] {
  const names: string[] = []
  const walk = (elements: MessageFormatElement[]): void => {
    for (const el of elements) {
      if ('value' in el && typeof el.value === 'string' && el.type !== TYPE.literal) {
        names.push(el.value)
      }
      if ('options' in el && el.options) {
        for (const option of Object.values(el.options)) walk(option.value)
      }
    }
  }
  walk(parse(message))
  return [...new Set(names)].sort()
}

/**
 * he.json is excluded: it predates this rule and deliberately hard-codes the
 * singular in a few count strings (e.g. forecast.voter → "מצביע אחד"), so it has
 * known, accepted placeholder gaps. ru/eo must stay in parity with en.
 */
describe('i18n placeholder parity (en ↔ ru, eo)', () => {
  it.each([
    ['ru', ru],
    ['eo', eo],
  ])('%s.json keeps every placeholder present in en.json', (locale, messages) => {
    const target = new Map(flatEntries(messages))
    const drift: string[] = []

    for (const [key, enValue] of flatEntries(en)) {
      const translated = target.get(key)
      if (translated === undefined) continue // covered by the key-parity tests

      // A locale may *add* placeholders (Russian wraps a bare "{count} results"
      // in an ICU plural), so require only that every English one survives.
      const actual = new Set(placeholders(translated))
      const dropped = placeholders(enValue).filter(p => !actual.has(p))

      if (dropped.length > 0) {
        drift.push(`  ${key}: dropped {${dropped.join('}, {')}}\n      en: ${enValue}\n      ${locale}: ${translated}`)
      }
    }

    expect(drift, `Placeholders dropped in ${locale}.json:\n${drift.join('\n')}`).toEqual([])
  })
})

// ─── Test 5: Source coverage ──────────────────────────────────────────────────

describe('i18n source coverage (static t() calls resolve in en.json)', () => {
  it('all static t() calls map to existing en.json keys', () => {
    const files = sourceFiles(join(ROOT, 'src'))
    const missing: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      const usages = extractTranslationUsages(source)
      for (const { namespace, key } of usages) {
        const full = `${namespace}.${key}`
        if (!enKeys.has(full)) {
          const rel = file.replace(ROOT + '/', '')
          missing.push(`  ${rel}: t('${key}') → "${full}" not found`)
        }
      }
    }

    expect(
      missing,
      `Missing i18n keys detected:\n${missing.join('\n')}\n\nAdd them to messages/en.json (and messages/he.json).`
    ).toEqual([])
  })
})
