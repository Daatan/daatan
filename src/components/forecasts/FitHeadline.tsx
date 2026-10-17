'use client'

import { useLayoutEffect, useRef } from 'react'

const MAX_LINES = 2
const MIN_FONT_PX = 12

/**
 * Card headline that never wraps past two lines. The length guards (headline.ts) bound the
 * text but not its rendered width — a 60-char headline of short words, or a longer Hebrew or
 * Russian translation, can still take a third line on a 360px phone. Rather than clip the
 * headline (it must stay complete), step the font size down one pixel at a time until it fits.
 * Wide screens and short headlines keep the stylesheet size untouched.
 */
export function FitHeadline({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const lineCount = () => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    const fit = () => {
      el.style.fontSize = ''
      let size = parseFloat(getComputedStyle(el).fontSize)
      while (lineCount() > MAX_LINES && size > MIN_FONT_PX) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
    }

    fit()
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return (
    <h2 ref={ref} className={className} data-testid="forecast-headline">
      {text}
    </h2>
  )
}
