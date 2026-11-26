import { describe, it, expect } from 'vitest'
import { OUTLET_PROFILES, FACT_KEYS, outletProfile, sourceLabel } from '../outlet-profiles'

const LOCALES = ['en', 'he', 'ru', 'eo']

describe('outlet profile data', () => {
  const entries = Object.entries(OUTLET_PROFILES)

  it('gives every outlet something to show', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [, p] of entries) expect(p.facts ?? p.wikipedia ?? p.researched).toBeDefined()
  })

  it('cites a source for every fact list and every researched sentence', () => {
    for (const [name, p] of entries) {
      if (p.facts) expect(p.factSources?.length, name).toBeGreaterThan(0)
      for (const s of p.researched ?? []) {
        expect(s.text.en, name).toBeTruthy()
        expect(s.sources.length, name).toBeGreaterThan(0)
      }
      for (const u of [...(p.factSources ?? []), ...(p.researched ?? []).flatMap(s => s.sources)]) {
        expect(u, name).toMatch(/^https:\/\//)
      }
    }
  })

  it('keeps each Wikipedia lead with its article and revision, in a language the site speaks', () => {
    for (const [name, p] of entries) {
      for (const [lang, w] of Object.entries(p.wikipedia ?? {})) {
        expect(LOCALES, name).toContain(lang)
        expect(w?.url, name).toMatch(new RegExp(`^https://${lang}\\.wikipedia\\.org/wiki/`))
        expect(w?.revision, name).toMatch(/^\d+$/)
        expect(w?.text.length, name).toBeGreaterThan(40)
      }
    }
  })

  it('links each outlet only to its own article, matching the lead shown for that language (daatan#2349)', () => {
    for (const [name, p] of entries) {
      for (const [lang, url] of Object.entries(p.wikipediaLinks ?? {})) {
        expect(LOCALES, name).toContain(lang)
        expect(url, name).toMatch(new RegExp(`^https://${lang}\\.wikipedia\\.org/wiki/`))
        const lead = p.wikipedia?.[lang]
        if (lead) expect(url, name).toBe(lead.url)
      }
    }
    // enwiki "Ynet" and "Ynetnews" redirect to the Yedioth Ahronoth article.
    expect(OUTLET_PROFILES['ynet.co.il'].wikipediaLinks?.en).toBeUndefined()
    expect(OUTLET_PROFILES['ynetnews.com'].wikipediaLinks).toBeUndefined()
  })

  it('labels the sources of one list with distinct hosts, so no two links read the same', () => {
    for (const [name, p] of entries) {
      for (const list of [p.factSources ?? [], [...new Set((p.researched ?? []).flatMap(s => s.sources))]]) {
        const hosts = list.map(sourceLabel)
        expect(new Set(hosts).size, name).toBe(hosts.length)
      }
    }
  })

  it('has an English label for every fact value and only known fact keys', () => {
    for (const [name, p] of entries) {
      for (const [k, v] of Object.entries(p.facts ?? {})) {
        expect(FACT_KEYS, name).toContain(k)
        if (typeof v === 'number') expect(v, name).toBeGreaterThan(1500)
        else for (const x of v) expect(x.en, name).toBeTruthy()
      }
    }
  })
})

describe('outletProfile', () => {
  it('shows the reader’s-language lead and facts in that language', () => {
    const p = outletProfile(['kikar.co.il'], 'he')
    expect(p?.about).toMatchObject({ kind: 'wikipedia', lang: 'he' })
    expect(p?.about?.kind === 'wikipedia' && p.about.url).toMatch(/^https:\/\/he\.wikipedia\.org\//)
    expect(p?.facts).toContainEqual({ key: 'country', value: 'ישראל' })
    expect(p?.facts.map(f => f.key)).toEqual(['founded', 'country', 'language'])
  })

  it('falls back to the English lead when the reader’s language has none', () => {
    const p = outletProfile(['kikar.co.il'], 'ru')
    expect(p?.about).toMatchObject({ kind: 'wikipedia', lang: 'en' })
  })

  it('prefers a Wikipedia lead over researched text, and researched text over nothing', () => {
    expect(outletProfile(['srugim.co.il'], 'he')?.about).toMatchObject({ kind: 'wikipedia', lang: 'he' })
    const en = outletProfile(['srugim.co.il'], 'en')?.about
    expect(en).toMatchObject({ kind: 'researched', lang: 'en' })
    expect(en?.kind === 'researched' && en.sources.length).toBeGreaterThan(0)
  })

  it('shows researched text in English when any sentence lacks the reader’s language', () => {
    expect(outletProfile(['oilprice.com'], 'ru')?.about).toMatchObject({ kind: 'researched', lang: 'ru' })
    expect(outletProfile(['oilprice.com'], 'eo')?.about).toMatchObject({ kind: 'researched', lang: 'en' })
  })

  it('never shows the enwiki redirect for Ynet, which is the Yedioth Ahronoth article', () => {
    for (const name of ['ynet.co.il', 'ynetnews.com']) {
      expect(outletProfile([name], 'en')?.about?.kind).toBe('researched')
    }
  })

  it('takes the first key with a profile, and none for unknown or prototype keys', () => {
    expect(outletProfile([null, 'maariv', 'kikar.co.il'], 'en')?.about).toMatchObject({ kind: 'wikipedia' })
    expect(outletProfile(['maariv', null], 'en')).toBeNull()
    expect(outletProfile(['constructor', 'toString'], 'en')).toBeNull()
  })

  it('links Wikipedia in the reader’s language, else English, else any language it has (daatan#2349)', () => {
    expect(outletProfile(['theguardian.com'], 'ru')?.wikipedia).toEqual({ url: 'https://ru.wikipedia.org/wiki/The_Guardian', lang: 'ru' })
    expect(outletProfile(['hnaftali.com'], 'he')?.wikipedia).toEqual({ url: 'https://en.wikipedia.org/wiki/Hananya_Naftali', lang: 'en' })
    expect(outletProfile(['srugim.co.il'], 'en')?.wikipedia?.lang).toBe('he')
    expect(outletProfile(['ynet.co.il'], 'en')?.wikipedia).toEqual({ url: 'https://he.wikipedia.org/wiki/Ynet', lang: 'he' })
  })

  it('still links an article whose lead is not shown, and links nothing without one (daatan#2349)', () => {
    const bbc = outletProfile(['bbc.com'], 'en')
    expect(bbc?.about?.kind).toBe('researched')
    expect(bbc?.wikipedia).toEqual({ url: 'https://en.wikipedia.org/wiki/BBC_News', lang: 'en' })
    for (const name of ['ynetnews.com', 'oilprice.com', 'newsletter.amitsegal.net']) {
      expect(outletProfile([name], 'en')?.wikipedia, name).toBeNull()
    }
  })

  it('gives a profile with no facts no fact sources', () => {
    const p = outletProfile(['hnaftali.com'], 'en')
    expect(p?.facts).toEqual([])
    expect(p?.factSources).toEqual([])
  })
})

describe('sourceLabel', () => {
  it('labels a link by its host without www', () => {
    expect(sourceLabel('https://www.wikidata.org/wiki/Q1')).toBe('wikidata.org')
    expect(sourceLabel('https://en.wikipedia.org/wiki/X')).toBe('en.wikipedia.org')
  })
})
