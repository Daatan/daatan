'use client'

import { useEffect, useEffectEvent } from 'react'
import type { Snapshot } from '@/components/forecasts/ContextTimeline'

/**
 * How long after publish the detail page waits for the Oracul's first estimate
 * (daatan#2347). `runCreationEstimate` (daatan#1777) writes it in the background, so a
 * page opened at publish time never showed it without a manual reload. Prod, the 30 days
 * to 2026-11-26: all 26 public BINARY forecasts got their first snapshot 34 s (median)
 * to 44 s (max) after publish. The window covers a slow search without polling forever
 * when the Oracul is off or the run failed.
 */
export const FIRST_ESTIMATE_WAIT_MS = 3 * 60_000
export const FIRST_ESTIMATE_POLL_MS = 5_000

interface WaitInput {
  status: string
  outcomeType: string
  isPublic: boolean
  publishedAt?: string | null
  confidence?: number | null
}

/**
 * When to stop waiting for the first estimate, or null when there is nothing to wait
 * for. Same gate as `runCreationEstimate`: only a public ACTIVE BINARY forecast gets one.
 */
export function firstEstimateDeadline(p: WaitInput, hasEstimate: boolean, nowMs: number): number | null {
  if (p.status !== 'ACTIVE' || p.outcomeType !== 'BINARY' || !p.isPublic) return null
  if (hasEstimate || p.confidence != null || !p.publishedAt) return null
  const deadline = Date.parse(p.publishedAt) + FIRST_ESTIMATE_WAIT_MS
  return nowMs < deadline ? deadline : null
}

/** Polls the public timeline until its first snapshot appears or `deadlineMs` passes. */
export function useFirstEstimatePoll(
  predictionId: string,
  deadlineMs: number | null,
  onArrived: (latest: Snapshot) => void,
) {
  const arrived = useEffectEvent(onArrived)
  useEffect(() => {
    if (deadlineMs == null) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const res = await fetch(`/api/forecasts/${predictionId}/context`)
        const latest = res.ok ? ((await res.json()) as { snapshots?: Snapshot[] }).snapshots?.[0] : undefined
        if (stopped) return
        if (latest) {
          arrived(latest)
          return
        }
      } catch {
        // Transient: the next tick retries.
      }
      if (!stopped && Date.now() + FIRST_ESTIMATE_POLL_MS < deadlineMs) {
        timer = setTimeout(tick, FIRST_ESTIMATE_POLL_MS)
      }
    }
    timer = setTimeout(tick, FIRST_ESTIMATE_POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [predictionId, deadlineMs])
}
