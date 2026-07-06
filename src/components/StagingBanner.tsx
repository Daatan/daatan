'use client'

import { useEffect, useState } from 'react'
import { VERSION } from '@/lib/version'

export const StagingBanner = () => {
  const [isStaging, setIsStaging] = useState(false)

  useEffect(() => {
    // Detect staging by hostname
    const hostname = window.location.hostname
    setIsStaging(hostname.includes('staging'))
  }, [])

  if (!isStaging) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-400 text-amber-900 text-center py-0.5 text-[10px] font-semibold tracking-wide">
      STAGING v{VERSION}
    </div>
  )
}

