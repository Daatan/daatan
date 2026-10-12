'use client'

import { usePathname } from 'next/navigation'
import { isBareChromePath } from '@/lib/bare-chrome'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isBare = isBareChromePath(pathname)
  // overflow-x-clip (not -hidden) clips wide content without creating a scroll
  // container, so position:sticky descendants (e.g. the feed header) keep working.
  return (
    <main
      id="main-content"
      // -1: not in tab order by default, but focusable via the skip link — a
      // plain <main> only scrolls into view on click, it doesn't move keyboard
      // focus, so the next Tab press would otherwise restart from the top.
      tabIndex={-1}
      className={`flex-1 min-w-0 overflow-x-clip focus:outline-none${isBare ? '' : ' lg:ml-64 mt-16 lg:mt-0'}`}
    >
      {children}
    </main>
  )
}
