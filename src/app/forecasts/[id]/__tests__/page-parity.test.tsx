/**
 * daatan#2351 — `/forecasts/[id]` and `/[locale]/forecasts/[id]` render the same
 * ForecastDetailClient. The locale route used to load its own copy of the data and
 * drifted for months (no `insufficientData`, no `usableEvidenceCount`, indexer-only
 * sources). Both now hand the client the same props; only the forecast's localized
 * text and the `isLocalized` flag may differ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUniqueUser: vi.fn(),
  auth: vi.fn(),
  listComments: vi.fn(),
  getContextTimeline: vi.fn(),
  getProbabilityHistory: vi.fn(),
  getPanelSeries: vi.fn(),
  getForecastVoters: vi.fn(),
  getContributingSources: vi.fn(),
  countUsableEvidence: vi.fn(),
  getRealCreator: vi.fn(),
  getCachedPredictionTranslation: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  permanentRedirect: (url: string) => { throw new Error(`REDIRECT ${url}`) },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findFirst: m.findFirst },
    user: { findUnique: m.findUniqueUser },
  },
}))
vi.mock('@/auth', () => ({ auth: m.auth }))
vi.mock('@/lib/services/comment', () => ({ listComments: m.listComments }))
vi.mock('@/lib/services/context', () => ({
  getContextTimeline: m.getContextTimeline,
  getProbabilityHistory: m.getProbabilityHistory,
}))
vi.mock('@/lib/services/ai-panel-read', () => ({ getPanelSeries: m.getPanelSeries }))
vi.mock('@/lib/services/forecast-sources', () => ({
  getForecastVoters: m.getForecastVoters,
  getContributingSources: m.getContributingSources,
}))
vi.mock('@/lib/services/evidence-pool', () => ({ countUsableEvidence: m.countUsableEvidence }))
vi.mock('@/lib/services/daatan-author', () => ({ getRealCreator: m.getRealCreator }))
vi.mock('@/lib/services/forecast', () => ({ getCanonicalSlugForAlias: vi.fn() }))
vi.mock('@/lib/services/translation', () => ({
  getCachedPredictionTranslation: m.getCachedPredictionTranslation,
}))
vi.mock('@/lib/author-json-ld', () => ({ authorJsonLd: () => ({}) }))
vi.mock('@/components/JsonLd', () => ({ JsonLd: () => null }))
vi.mock('@/components/forecasts/RelatedForecasts', () => ({ default: () => null }))
vi.mock('../ForecastDetailClient', () => ({ default: function ForecastDetailClient() { return null } }))

import ForecastDetailClient from '../ForecastDetailClient'
import CanonicalPage from '../page'
import LocalePage from '../../../[locale]/forecasts/[id]/page'

const SLUG = 'the-claim'
const at = new Date('2026-11-26T10:00:00.000Z')

const row = () => ({
  id: 'pred-1',
  slug: SLUG,
  claimText: 'The claim',
  detailsText: 'Details',
  resolutionRules: 'Rules',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  isPublic: true,
  confidence: null,
  createdAt: at,
  updatedAt: at,
  publishedAt: at,
  resolveByDatetime: new Date('2027-05-25T23:59:59.000Z'),
  contextUpdatedAt: null,
  resolvedAt: null,
  lockedAt: null,
  claimDeadline: null,
  outcomePayload: null,
  evidenceLinks: null,
  author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, eloRating: 1500, role: 'USER', twitterHandle: 'handle' },
  newsAnchor: null,
  tags: [{ id: 't1', name: 'Israel', slug: 'israel' }],
  options: [],
  commitments: [],
  externalMarket: null,
  _count: { commitments: 0 },
})

/** The props of the first ForecastDetailClient element in a server component's tree. */
function clientProps(node: ReactNode): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = clientProps(child)
      if (found) return found
    }
    return null
  }
  const el = node as ReactElement<{ children?: ReactNode }>
  if (el.type === ForecastDetailClient) return el.props as Record<string, unknown>
  return clientProps(el.props?.children)
}

const withoutLocaleParts = (props: Record<string, unknown>) => {
  const { initialData: _data, isLocalized: _localized, ...rest } = props
  return rest
}

describe('forecast page routes hand ForecastDetailClient the same data (daatan#2351)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.findFirst.mockResolvedValue(row())
    m.auth.mockResolvedValue(null)
    m.listComments.mockResolvedValue({ comments: [] })
    m.getContextTimeline.mockResolvedValue({
      contextSnapshots: [{
        id: 's1',
        summary: '',
        sources: [],
        createdAt: at,
        externalProbability: null,
        externalReasoning: 'TruthMachine Oracle',
        oracleSnapshot: null,
        insufficientData: true,
      }],
    })
    m.getProbabilityHistory.mockResolvedValue([])
    m.getPanelSeries.mockResolvedValue([])
    m.getForecastVoters.mockResolvedValue([{ url: 'https://oracul.example/a', origin: 'oracle' }])
    m.getContributingSources.mockResolvedValue([{ url: 'https://indexer.example/b' }])
    m.countUsableEvidence.mockResolvedValue(4)
    m.getRealCreator.mockResolvedValue(null)
    m.getCachedPredictionTranslation.mockResolvedValue({})
  })

  it('same props from both routes, apart from the localized forecast text', async () => {
    const canonical = clientProps(await CanonicalPage({ params: Promise.resolve({ id: SLUG }) }))
    const localized = clientProps(await LocalePage({ params: Promise.resolve({ locale: 'he', id: SLUG }) }))
    expect(canonical).not.toBeNull()
    expect(localized).not.toBeNull()
    expect(withoutLocaleParts(localized!)).toEqual(withoutLocaleParts(canonical!))
  })

  it('the localized page gets the abstention, the evidence count and the merged sources', async () => {
    const props = clientProps(await LocalePage({ params: Promise.resolve({ locale: 'he', id: SLUG }) }))!
    expect((props.initialContextSnapshots as { insufficientData?: boolean }[])[0].insufficientData).toBe(true)
    expect(props.usableEvidenceCount).toBe(4)
    expect(props.initialContributingSources).toEqual([{ url: 'https://oracul.example/a', origin: 'oracle' }])
    expect(m.getContributingSources).not.toHaveBeenCalled()
    const data = props.initialData as { tags: unknown[]; author: { twitterHandle: string } }
    expect(data.tags).toHaveLength(1)
    expect(data.author.twitterHandle).toBe('handle')
  })
})
