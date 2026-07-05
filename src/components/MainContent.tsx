'use client'

import { usePathname } from 'next/navigation'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuth = pathname.startsWith('/auth/')
  // overflow-x-clip (not -hidden) clips wide content without creating a scroll
  // container, so position:sticky descendants (e.g. the feed header) keep working.
  return (
    <main id="main-content" className={`flex-1 min-w-0 overflow-x-clip${isAuth ? '' : ' lg:ml-64 mt-16 lg:mt-0'}`}>
      {children}
    </main>
  )
}
