'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

/**
 * Forecast claim on a feed card, clamped to three lines for feed density (daatan#1805).
 * A long claim (~500 chars) used to be cut mid-sentence with the rest only in a hover
 * tooltip, which touch screens never show. When — and only when — the clamp actually hides
 * text, a small "Show more" toggle expands it inline. Overflow is measured (scrollHeight vs
 * clientHeight) rather than guessed from character count, since the fit depends on card
 * width, font and script; a ResizeObserver re-measures on resize.
 *
 * The card is a stretched overlay link (z-[1]); the toggle sits above it (z-[2]) and stops
 * the event so expanding never navigates.
 */
export function ClampedClaim({
  text,
  as: Tag = 'p',
  className = '',
}: {
  text: string
  as?: 'p' | 'h2'
  className?: string
}) {
  const t = useTranslations('forecast')
  const ref = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    // ResizeObserver fires once on observe(), so this also covers the initial measurement
    // and a text change (the effect re-subscribes when `text` changes).
    const observer = new ResizeObserver(() => {
      setOverflows(el.scrollHeight > el.clientHeight + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <>
      <Tag ref={ref} className={`${className} ${expanded ? '' : 'line-clamp-3'}`} title={expanded ? undefined : text}>
        {text}
      </Tag>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(v => !v) }}
          aria-expanded={expanded}
          className="relative z-[2] mt-1 text-xs font-medium text-cobalt-light hover:underline"
          data-testid="claim-toggle"
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </>
  )
}
