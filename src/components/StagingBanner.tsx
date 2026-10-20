'use client'

import { VERSION } from '@/lib/version'
import { useBrowserValue } from '@/lib/hooks/useIsClient'

export const StagingBanner = () => {
  // Detect staging by hostname
  const isStaging = useBrowserValue(() => window.location.hostname.includes('staging'), false)

  if (!isStaging) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-400 text-amber-900 text-center py-0.5 text-[10px] font-semibold tracking-wide">
      STAGING v{VERSION}
    </div>
  )
}

