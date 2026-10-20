'use client'

import { useIsClient } from '@/lib/hooks/useIsClient'

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const hasMounted = useIsClient()

  if (!hasMounted) {
    return null
  }

  return <>{children}</>
}
