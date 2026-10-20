'use client'

import { VERSION } from '@/lib/version'
import { useBrowserValue } from '@/lib/hooks/useIsClient'

export const NextBanner = () => {
  // Detect next testbed by hostname
  const isNext = useBrowserValue(() => window.location.hostname.includes('next'), false)

  if (!isNext) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-cobalt/80 text-white text-center py-0.5 text-[10px] font-semibold tracking-wide flex items-center justify-center gap-2">
      <span className="bg-white text-cobalt px-1 rounded-[2px] text-[8px]">NEXT</span>
      TESTBED v{VERSION}
    </div>
  )
}
