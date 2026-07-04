import type { UserRole } from '@prisma/client'

export type Prediction = {
  id: string
  slug?: string | null
  isPublic: boolean
  shareToken: string
  claimText: string
  detailsText?: string | null
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'NUMERIC_THRESHOLD'
  outcomePayload?: Record<string, unknown>
  status: string
  createdAt: string
  lockedAt?: string | null
  resolveByDatetime: string
  contextUpdatedAt?: string
  publishedAt?: string
  resolvedAt?: string
  resolutionOutcome?: string | null
  resolutionNote?: string | null
  evidenceLinks?: string[]
  resolutionRules?: string | null
  sentiment?: string | null
  confidence?: number | null
  aiCiLow?: number | null
  aiCiHigh?: number | null
  /** Oracle settlement pin — outcome reported as fact, awaiting human resolution. */
  settled?: boolean
  /** Parsed from claim TEXT by the temporal classifier — may diverge from resolveByDatetime. */
  claimDeadline?: string | null
  claimArchetype?: 'DIFFUSE' | 'SCHEDULED' | 'THRESHOLD' | 'NONE' | null
  extractedEntities?: string[]
  consensusLine?: string | null
  sourceSummary?: string | null
  source?: string | null
  author: {
    id: string
    name: string | null
    username?: string | null
    image?: string | null
    rs: number
    role?: UserRole
  }
  newsAnchor?: {
    id: string
    title: string
    url: string
    source?: string | null
  } | null
  tags?: Array<{
    id: string
    name: string
    slug: string
  }>
  options: Array<{
    id: string
    text: string
    isCorrect?: boolean | null
  }>
  commitments: Array<{
    id: string
    cuCommitted: number
    binaryChoice?: boolean | null
    rsSnapshot: number
    createdAt: string
    rsChange?: number | null
    probability?: number | null
    user: {
      id: string
      name: string | null
      username?: string | null
      image?: string | null
    }
    option?: {
      id: string
      text: string
    } | null
  }>
  externalMarket?: {
    provider: 'POLYMARKET' | 'KALSHI'
    slug: string
    url: string
    question: string
    /** Outcome labels in price order (Json column), e.g. ["Yes","No"]. */
    outcomes?: unknown
    resolved: boolean
    /** Raw provider prices — NOT polarity-adjusted. Display through
     *  marketDisplayProbability() so externalMarketInverted is honored. */
    snapshots: Array<{ createdAt: string; probability: number }>
  } | null
  /** The linked market asks the opposite question; display 100 − price. */
  externalMarketInverted?: boolean
  totalCuCommitted?: number
  userCommitment?: {
    id: string
    cuCommitted: number
    binaryChoice?: boolean
    optionId?: string
    createdAt?: string
    rsChange?: number | null
    brierScore?: number | null
    option?: { id: string; text: string } | null
  }
}
