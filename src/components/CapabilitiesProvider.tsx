'use client'

import { createContext, useContext } from 'react'
import type { Capabilities } from '@/lib/capabilities'

// SaaS-equivalent default (everything on). The root layout always provides the
// real server-resolved value; this default only matters for components rendered
// outside the provider (e.g. isolated tests), keeping their behavior unchanged.
const DEFAULT: Capabilities = { ai: true, aiResearch: true, externalMarkets: true, selfHosted: false }

const CapabilitiesContext = createContext<Capabilities>(DEFAULT)

export function CapabilitiesProvider({
  value,
  children,
}: {
  value: Capabilities
  children: React.ReactNode
}) {
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext)
}
