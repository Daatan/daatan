'use client'

import { useSyncExternalStore } from 'react'

const subscribeNoop = () => () => {}

/** False on the server and during hydration, true afterwards — a hydration-safe "has mounted" flag without an effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}

/** Reads a browser-only value (hostname, storage…) with a server/hydration fallback; no setState in an effect. */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNoop, read, () => serverValue)
}
