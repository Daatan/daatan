'use client'

import { useEffect, useState } from 'react'

// Clears the fixed mobile header (Sidebar.tsx, h-16) when jumping to a section.
const HEADER_OFFSET = 80

/** Floating right-hand "next section" button for the long retro reports (daatan#1779);
 *  at the end of the page it becomes "back to top". */
export default function ScrollNav() {
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const update = () => setAtEnd(window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120)
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  const go = () => {
    if (atEnd) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const next = Array.from(document.querySelectorAll<HTMLElement>('.retro-light section'))
      .find(s => s.getBoundingClientRect().top > HEADER_OFFSET + 10)
    const top = next
      ? next.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET
      : window.scrollY + window.innerHeight * 0.8
    window.scrollTo({ top, behavior: 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={go}
      aria-label={atEnd ? 'Back to top' : 'Next section'}
      title={atEnd ? 'Back to top' : 'Next section'}
      className="fixed right-4 bottom-6 md:right-8 md:bottom-8 z-40 grid place-items-center w-12 h-12 rounded-full bg-gray-900/90 text-white shadow-lg ring-1 ring-white/20 hover:bg-gray-700 transition-colors"
    >
      <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className={`transition-transform ${atEnd ? 'rotate-180' : ''}`}>
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  )
}
