import { env } from '@/env'

export interface PublicOutletLink {
  label: string
  url: string
}

export interface PublicOutletSourceConfig {
  type: string
  locator: string | null
  language: string | null
  enabled: boolean
  domain: string | null
}

export interface PublicOutletImpact {
  matches: number
  forecastsAffected: number
  last30dMatches: number
  lastMatchedAt: string | null
}

export interface PublicOutletPublication {
  title: string | null
  url: string | null
  source: string | null
  publishedAt: string | null
  pushedAt: string | null
  forecastId: string | null
  outcome: string | null
}

export interface PublicOutletLinkedPerson {
  id: string
  canonicalName: string
}

export interface PublicOutletDetail {
  name: string
  wikipediaUrl: string | null
  telegramChannel: string | null
  links: PublicOutletLink[]
  sourceConfig: PublicOutletSourceConfig | null
  impact: PublicOutletImpact
  publications: PublicOutletPublication[]
  linkedPeople: PublicOutletLinkedPerson[]
}

/**
 * Public, read-only outlet detail — the same news-indexer `GET /outlets/{name}` call the
 * admin panel proxies (src/app/api/admin/news-indexer/sources/[name]/route.ts), but with no
 * auth gate and with `notes` (admin-only editorial free text) deliberately excluded from the
 * returned shape.
 *
 * Fails open — returns null (never throws) when news-indexer is unconfigured, the outlet
 * doesn't exist, or the request fails.
 */
export async function getPublicOutletDetail(name: string): Promise<PublicOutletDetail | null> {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return null

  try {
    const res = await fetch(`${env.NEWS_INDEXER_URL}/outlets/${encodeURIComponent(name)}`, {
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
      cache: 'no-store',
    })
    if (!res.ok) return null

    const data = await res.json()
    return {
      name: data.name,
      wikipediaUrl: data.wikipediaUrl ?? null,
      telegramChannel: data.telegramChannel ?? null,
      links: data.links ?? [],
      sourceConfig: data.sourceConfig ?? null,
      impact: data.impact,
      publications: data.publications ?? [],
      linkedPeople: data.linkedPeople ?? [],
    }
  } catch {
    return null
  }
}
