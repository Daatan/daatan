import type { SourceLeaderboardView } from '@/lib/services/sourceLeaderboard'

// Shared by the server page and the client component. It must not live in the 'use client'
// module: the server would import a client reference, and calling it throws (#2212).
export function parseView(raw: string | null | undefined): SourceLeaderboardView {
  return raw === 'authors' ? 'authors' : 'outlets'
}
