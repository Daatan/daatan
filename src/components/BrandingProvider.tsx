'use client'

import { createContext, useContext } from 'react'
import type { Branding } from '@/lib/branding'

// SaaS-equivalent default (DAATAN identity, bundled logos). The root layout
// always provides the real server-resolved value; this default only applies to
// components rendered outside the provider (e.g. isolated tests), keeping their
// output unchanged.
const DEFAULT: Branding = { appName: 'DAATAN', logoUrl: null }

const BrandingContext = createContext<Branding>(DEFAULT)

export function BrandingProvider({ value, children }: { value: Branding; children: React.ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding(): Branding {
  return useContext(BrandingContext)
}
