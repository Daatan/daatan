import { describe, it, expect, vi } from 'vitest'

vi.mock('next/server', () => ({ connection: vi.fn() }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com', shouldIndex: () => true }))

import robots from '../robots'

/** Google/Bing robots.txt path matching: prefix match, `*` = any run, trailing `$` = end. */
function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$')
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

async function blocked(path: string): Promise<boolean> {
  const { rules } = await robots()
  const group = Array.isArray(rules) ? rules[0] : rules
  const disallow = ([] as string[]).concat(group.disallow ?? [])
  return disallow.some((rule) => matches(rule, path))
}

describe('robots.txt disallow rules', () => {
  it('still blocks the create-flow pages themselves', async () => {
    expect(await blocked('/forecasts/new')).toBe(true)
    expect(await blocked('/forecasts/express')).toBe(true)
    expect(await blocked('/forecasts/new?ref=nav')).toBe(true)
    expect(await blocked('/forecasts/express?topic=x')).toBe(true)
    expect(await blocked('/create')).toBe(true)
    expect(await blocked('/forecasts/some-forecast/edit')).toBe(true)
  })

  it('does not block forecast slugs that merely start with "new" or "express"', async () => {
    expect(await blocked('/forecasts/new-knesset-elections-will-be-held-in-israel-before-april-30-2027')).toBe(false)
    expect(await blocked('/forecasts/express-train-line-will-open-by-2027')).toBe(false)
    expect(await blocked('/forecasts/some-forecast')).toBe(false)
  })

  it('lets crawlers reach the retro case studies in every language (daatan#2249)', async () => {
    for (const path of ['/retroanalysis', '/retroanalysis/ukraine-2022', '/he/retroanalysis/israel-2022', '/ru/retroanalysis/energy-2022']) {
      expect(await blocked(path)).toBe(false)
    }
  })
})
