import data from './outlet-profiles.json'

/**
 * Who an outlet is, for the source page header (daatan#2345): facts from Wikidata, the lead of
 * its Wikipedia article, and, where those are thin, a few sentences Daatan wrote from cited
 * sources. Keys are exact outlet names (an alias domain has its own entry or none). The JSON is
 * generated; how, and every hand decision: docs/OUTLET_PROFILES.md.
 */
type Localized = { en: string } & Partial<Record<string, string>>

export interface OutletProfileData {
  wikidata?: string
  facts?: {
    founded?: number
    country?: Localized[]
    headquarters?: Localized[]
    language?: Localized[]
    owner?: Localized[]
  }
  factSources?: string[]
  /** Unmodified Wikipedia text (CC BY-SA 4.0), per language. */
  wikipedia?: Partial<Record<string, { text: string; url: string; revision: string }>>
  /** The outlet's own article per language, including ones whose lead is not shown (daatan#2349). */
  wikipediaLinks?: Partial<Record<string, string>>
  researched?: { text: Localized; sources: string[] }[]
}

export const OUTLET_PROFILES: Record<string, OutletProfileData> = data

export const FACT_KEYS = ['founded', 'country', 'headquarters', 'language', 'owner'] as const
export type FactKey = (typeof FACT_KEYS)[number]

export type OutletAbout =
  | { kind: 'wikipedia'; text: string; lang: string; url: string }
  | { kind: 'researched'; text: string; lang: string; sources: string[] }

export interface OutletProfile {
  facts: { key: FactKey; value: string }[]
  factSources: string[]
  about: OutletAbout | null
  /** The header's Wikipedia button: the reader's language, else English, else any (daatan#2349). */
  wikipedia: { url: string; lang: string } | null
}

function pick(l: Localized, locale: string): string {
  return l[locale] ?? l.en
}

/**
 * The profile of the first key that has one. The paragraph is the reader's-language Wikipedia
 * lead, else the English one, else the researched text (in the reader's language when every
 * sentence has it). Wikipedia text is never translated or cut, as its licence asks.
 */
export function outletProfile(keys: Iterable<string | null>, locale: string): OutletProfile | null {
  for (const key of keys) {
    if (key === null || !Object.hasOwn(OUTLET_PROFILES, key)) continue
    const p = OUTLET_PROFILES[key]
    const facts = FACT_KEYS.flatMap((k): { key: FactKey; value: string }[] => {
      const v = p.facts?.[k]
      if (v === undefined) return []
      return [{ key: k, value: typeof v === 'number' ? String(v) : v.map(x => pick(x, locale)).join(', ') }]
    })

    let about: OutletAbout | null = null
    const leadLang = p.wikipedia?.[locale] ? locale : p.wikipedia?.en ? 'en' : null
    const lead = leadLang ? p.wikipedia?.[leadLang] : undefined
    if (leadLang && lead) {
      about = { kind: 'wikipedia', text: lead.text, lang: leadLang, url: lead.url }
    } else if (p.researched?.length) {
      const lang = p.researched.every(s => s.text[locale]) ? locale : 'en'
      about = {
        kind: 'researched',
        lang,
        text: p.researched.map(s => pick(s.text, lang)).join(' '),
        sources: [...new Set(p.researched.flatMap(s => s.sources))],
      }
    }
    const links = p.wikipediaLinks ?? {}
    const linkLang = [locale, 'en', ...Object.keys(links)].find(l => links[l])
    const wikipedia = linkLang ? { url: links[linkLang]!, lang: linkLang } : null
    return { facts, factSources: facts.length > 0 ? p.factSources ?? [] : [], about, wikipedia }
  }
  return null
}

/** The host a source link is labelled with: "https://www.wikidata.org/wiki/Q1" → "wikidata.org". */
export function sourceLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}
