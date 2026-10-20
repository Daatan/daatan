'use client'

import { useEffect, useState } from 'react'

/** Current time in ms, read once on mount and (optionally) refreshed every `refreshMs`. Keeps `Date.now()` out of render. */
export function useNowMs(refreshMs?: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!refreshMs) return
    const id = setInterval(() => setNow(Date.now()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])
  return now
}
