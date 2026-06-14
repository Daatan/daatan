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
    cuReturned?: number | null
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
  polymarketMarket?: {
    slug: string
    question: string
    resolved: boolean
    snapshots: Array<{ createdAt: string; probability: number }>
  } | null
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
