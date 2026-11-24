'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Maximize2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { ArticleDot } from '@/lib/article-dots'
import { DAY_MS, ZOOM_PRESET_DAYS, presetApplies, presetDomain, tickTimestamps, zoomTo } from '@/lib/chart-zoom'
import type { Side } from '@/lib/source-vote'
import { articleHost } from '@/lib/utils/source-page'

/** One published Oracul estimate — the line the dots are drawn over. `p` is 0–100. */
export type AiLinePoint = { t: number; p: number }

const SIDE_COLOR: Record<Side, string> = { yes: '#10B981', no: '#F43F5E', neutral: '#6B7280' }
const SIDE_BADGE: Record<Side, string> = {
  yes: 'bg-emerald-500/20 text-emerald-300',
  no: 'bg-rose-500/20 text-rose-300',
  neutral: 'bg-gray-500/20 text-gray-400',
}
const SIDE_VOTE_KEY = { yes: 'voteYes', no: 'voteNo', neutral: 'voteNeutral' } as const
/** Same amber, same dash as the compact chart's "AI (Oracul)" line. */
const LINE_COLOR = '#FBBF24'

const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28
/** A pointer-down with less travel than this is a click, not a brush (elections' BRUSH_MIN_PX). */
const BRUSH_MIN_PX = 4
/** Grace period for moving the pointer from a dot into its tooltip (to reach the outlet link). */
const HOVER_CLOSE_MS = 150
/** A single instant has no width to draw; pad it to a day so its dots spread around the middle. */
const POINT_DOMAIN_PAD_MS = DAY_MS / 2

/** Dot radius in px: certainty is the vote's weight in the pool, so it sets the area a reader
 *  notices first. A missing certainty draws the smallest dot rather than a guessed middle one. */
export function dotRadius(certainty: number | null): number {
  return 3 + 6 * (certainty ?? 0)
}

/** The header control that opens the expanded view. Its own component so the compact chart
 *  only reads translations when the expanded view is actually on offer. */
export function ExpandChartButton({ onClick, ref }: { onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const t = useTranslations('articleDots')
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      title={t('expandHint')}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border border-navy-600 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
    >
      <Maximize2 className="w-3 h-3" aria-hidden="true" />
      {t('expand')}
    </button>
  )
}

type DotsBody = { dots: ArticleDot[]; poolSize: number; truncated: boolean }
type Load = { state: 'loading' } | { state: 'error' } | ({ state: 'ready' } & DotsBody)
type PlacedDot = ArticleDot & { t: number }

/**
 * The expanded "Probability over time" view (daatan#2300): the Oracul's line with every article
 * in its current pool as a dot — x when first read, y the article's own vote (1 + stance) / 2,
 * size its certainty, colour its side. A modal over the page on wide screens, a full-screen sheet on
 * phones. Its series is fetched on open (`GET /api/forecasts/[id]/article-dots`).
 */
export function ArticleDotsView({
  forecastId,
  aiLine,
  onClose,
}: {
  forecastId: string
  aiLine: AiLinePoint[]
  onClose: () => void
}) {
  const t = useTranslations('articleDots')
  const tSources = useTranslations('sources')
  const locale = useLocale()
  const titleId = useId()
  const clipId = useId()

  const [load, setLoad] = useState<Load>({ state: 'loading' })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/forecasts/${encodeURIComponent(forecastId)}/article-dots`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(({ dots, poolSize, truncated }: DotsBody) => setLoad({ state: 'ready', dots, poolSize, truncated }))
      .catch(() => {
        if (!ctrl.signal.aborted) setLoad({ state: 'error' })
      })
    return () => ctrl.abort()
  }, [forecastId])

  // Escape closes; Tab stays inside the dialog; the page behind doesn't scroll; a press on the
  // backdrop (outside the panel) closes. Native listeners, so the panel itself carries no
  // keyboard/mouse handlers of its own.
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement | SVGElement>('a[href], button:not([disabled])')
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    const backdrop = backdropRef.current
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    backdrop?.addEventListener('mousedown', onBackdrop)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      backdrop?.removeEventListener('mousedown', onBackdrop)
    }
  }, [])

  // The chart draws in CSS pixels (1 viewBox unit = 1 px), so dots stay round and labels stay
  // legible at any width — a fixed viewBox scaled down to a phone would shrink both.
  const boxRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width && width > 0) setW(Math.round(width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = w < 640 ? 340 : 380

  const dots: PlacedDot[] = useMemo(
    () =>
      load.state === 'ready'
        ? load.dots.map((d) => ({ ...d, t: Date.parse(d.firstSeenAt) })).filter((d) => Number.isFinite(d.t))
        : [],
    [load],
  )
  const line = [...aiLine].sort((a, b) => a.t - b.t)

  const allT = [...line.map((p) => p.t), ...dots.map((d) => d.t)]
  const spanned: [number, number] | null = allT.length ? [Math.min(...allT), Math.max(...allT)] : null
  const full: [number, number] | null = spanned
    ? spanned[0] === spanned[1]
      ? [spanned[0] - POINT_DOMAIN_PAD_MS, spanned[1] + POINT_DOMAIN_PAD_MS]
      : spanned
    : null

  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [active, setActive] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerType = useRef<string>('mouse')
  const tipRef = useRef<HTMLDivElement>(null)
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const show = (url: string) => {
    cancelHide()
    setActive(url)
  }
  const hideSoon = () => {
    if (pinned) return
    cancelHide()
    hideTimer.current = setTimeout(() => setActive(null), HOVER_CLOSE_MS)
  }
  useEffect(() => {
    const timer = hideTimer
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
  // A tapped-open tooltip stays until the reader taps elsewhere (elections' convention).
  useEffect(() => {
    if (!pinned) return
    const close = () => {
      setPinned(false)
      setActive(null)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [pinned])

  const inRange = zoom != null && full != null && zoom[0] >= full[0] && zoom[1] <= full[1]
  const domain: [number, number] | null = full ? (inRange ? (zoom as [number, number]) : full) : null

  const outletLabel = (d: ArticleDot) => d.outlet || articleHost(d.url) || d.url
  const voteText = (d: ArticleDot) =>
    t('vote', { vote: tSources(SIDE_VOTE_KEY[d.side]), pct: Math.round(d.probYes * 100) })

  const header = (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-bold text-gray-300 uppercase tracking-widest">
          {t('title')}
        </h2>
        {load.state === 'ready' && dots.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">{t('subtitle', { count: dots.length })}</p>
        )}
        {load.state === 'ready' && load.truncated && (
          <p data-testid="article-dots-truncated" className="text-xs text-amber-400/80 mt-0.5">
            {t('truncated', { shown: dots.length, total: load.poolSize })}
          </p>
        )}
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t('close')}
        className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-navy-600"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  )

  let body: ReactNode
  if (load.state === 'loading') {
    body = <p className="py-20 text-center text-sm text-gray-500">{t('loading')}</p>
  } else if (load.state === 'error') {
    body = <p className="py-20 text-center text-sm text-gray-400">{t('error')}</p>
  } else if (dots.length === 0 || !domain || !full) {
    body = <p className="py-20 text-center text-sm text-gray-500">{t('empty')}</p>
  } else {
    const [tMin, tMax] = domain
    const tSpan = tMax - tMin || 1
    const plotW = Math.max(1, w - PAD_L - PAD_R)
    const plotH = H - PAD_T - PAD_B
    const x = (tt: number) => PAD_L + ((tt - tMin) / tSpan) * plotW
    const y = (pct: number) => PAD_T + (1 - pct / 100) * plotH
    const tAt = (vx: number) => tMin + ((vx - PAD_L) / plotW) * tSpan
    const vxAt = (clientX: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return 0
      return ((clientX - rect.left) / rect.width) * w
    }
    const brushing = brush != null && Math.abs(brush.x1 - brush.x0) >= BRUSH_MIN_PX
    const commitBrush = () => {
      if (brush && brushing) {
        const next = zoomTo(full, tAt(brush.x0), tAt(brush.x1))
        if (next) setZoom(next)
      }
      setBrush(null)
    }

    // Step line (the estimate holds until the next one), carried to the right edge of the data.
    let path = ''
    line.forEach((p, i) => {
      path += i === 0 ? `M${x(p.t)},${y(p.p)}` : `H${x(p.t)}V${y(p.p)}`
    })
    if (line.length > 0 && full[1] > line[line.length - 1].t) path += `H${x(full[1])}`

    const visible = dots
      .filter((d) => d.t >= tMin && d.t <= tMax)
      .sort((a, b) => dotRadius(b.certainty) - dotRadius(a.certainty))
    const activeDot = active ? visible.find((d) => d.url === active) ?? null : null

    const spanMs = tMax - tMin
    const fmt = new Intl.DateTimeFormat(
      locale,
      spanMs < 2 * DAY_MS
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : spanMs > 300 * DAY_MS
          ? { month: 'short', year: 'numeric' }
          : { month: 'short', day: 'numeric' },
    )
    const tooltipFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const xTicks = [tMin, ...tickTimestamps(tMin, tMax, w < 480 ? 1 : 3), tMax]

    body = (
      <div className="relative">
        <svg
          ref={svgRef}
          width={w}
          height={H}
          viewBox={`0 0 ${w} ${H}`}
          className="block select-none"
          role="img"
          aria-label={t('chartLabel')}
          // Time runs left→right in every locale, so the SVG never takes the page's RTL
          // direction (SVG text-anchor would flip with it). `pan-y`: a horizontal drag brushes,
          // a vertical one still scrolls the sheet.
          style={{ direction: 'ltr', touchAction: 'pan-y', cursor: 'crosshair' }}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return
            e.currentTarget.setPointerCapture?.(e.pointerId)
            const vx = vxAt(e.clientX)
            setBrush({ x0: vx, x1: vx })
          }}
          onPointerMove={(e) => {
            if (brush) setBrush({ x0: brush.x0, x1: vxAt(e.clientX) })
          }}
          onPointerUp={commitBrush}
          onPointerCancel={() => setBrush(null)}
          onDoubleClick={() => setZoom(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD_L} y={0} width={plotW} height={H} />
            </clipPath>
          </defs>

          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line
                x1={PAD_L}
                x2={PAD_L + plotW}
                y1={y(v)}
                y2={y(v)}
                stroke={v === 50 ? '#4A5568' : '#2D3748'}
                strokeDasharray={v === 50 ? undefined : '3 3'}
              />
              <text x={PAD_L - 6} y={y(v)} dy={3} fontSize={11} fill="#718096" textAnchor="end">
                {v}%
              </text>
            </g>
          ))}
          {xTicks.map((tt, i) => (
            <text
              key={`${i}-${tt}`}
              x={x(tt)}
              y={H - 8}
              fontSize={11}
              fill="#718096"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {fmt.format(tt)}
            </text>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {path && <path d={path} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeDasharray="4 2" />}
            {visible.map((d) => {
              const isActive = d.url === active
              const color = SIDE_COLOR[d.side]
              return (
                <a
                  key={d.url}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={t('dotLabel', { title: d.title || t('untitled'), outlet: outletLabel(d), vote: voteText(d) })}
                  onPointerDown={(e) => {
                    pointerType.current = e.pointerType
                    e.stopPropagation()
                  }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') show(d.url)
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'mouse') hideSoon()
                  }}
                  onFocus={() => show(d.url)}
                  onBlur={(e) => {
                    if (!tipRef.current?.contains(e.relatedTarget as Node | null)) hideSoon()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Touch has no hover: the first tap opens the tooltip, the second follows the link.
                    if (pointerType.current !== 'mouse' && active !== d.url) {
                      e.preventDefault()
                      show(d.url)
                      setPinned(true)
                    }
                  }}
                >
                  <circle
                    cx={x(d.t)}
                    cy={y(d.probYes * 100)}
                    r={dotRadius(d.certainty)}
                    fill={color}
                    fillOpacity={isActive ? 0.9 : 0.5}
                    stroke={isActive ? '#FFFFFF' : color}
                    strokeWidth={isActive ? 2 : 1}
                  />
                </a>
              )
            })}
          </g>

          {brushing && brush && (
            <rect
              x={Math.min(brush.x0, brush.x1)}
              y={PAD_T}
              width={Math.abs(brush.x1 - brush.x0)}
              height={plotH}
              fill="#3B82F6"
              fillOpacity={0.15}
              stroke="#3B82F6"
              strokeOpacity={0.5}
            />
          )}
        </svg>

        {activeDot && (
          <div
            ref={tipRef}
            data-testid="article-dot-tooltip"
            onPointerEnter={cancelHide}
            onPointerLeave={hideSoon}
            className="absolute z-10 w-64 max-w-[80vw] rounded-lg border border-navy-600 bg-navy-800 p-3 text-xs shadow-xl"
            style={{
              left: x(activeDot.t),
              top: y(activeDot.probYes * 100),
              transform: `translate(${x(activeDot.t) > w * 0.66 ? 'calc(-100% - 10px)' : x(activeDot.t) < w * 0.33 ? '10px' : '-50%'}, ${
                y(activeDot.probYes * 100) > H / 2 ? 'calc(-100% - 10px)' : '10px'
              })`,
            }}
          >
            <a
              href={activeDot.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block font-medium text-gray-100 hover:underline line-clamp-3"
            >
              {activeDot.title || t('untitled')}
            </a>
            <div className="mt-1 text-[11px] text-gray-400">
              {activeDot.outletPath ? (
                <Link href={activeDot.outletPath} className="hover:text-gray-200 hover:underline">
                  {outletLabel(activeDot)}
                </Link>
              ) : (
                outletLabel(activeDot)
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SIDE_BADGE[activeDot.side]}`}>
                {voteText(activeDot)}
              </span>
              <span className="text-[11px] text-gray-500">
                {t('firstRead', { date: tooltipFmt.format(activeDot.t) })}
              </span>
            </div>
          </div>
        )}
      </div>
    )
  }

  const zoomed = inRange
  const presets = full ? ZOOM_PRESET_DAYS.filter((d) => presetApplies(full, d)) : []
  const pill = (on: boolean) =>
    `px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
      on ? 'bg-cobalt-hover text-white' : 'text-gray-500 hover:text-gray-300'
    }`

  // Portalled to <body> so no transformed/overflow-clipped ancestor on the forecast page can
  // capture the fixed-position sheet.
  return createPortal(
    <div ref={backdropRef} className="fixed inset-0 z-[70] flex bg-black/70 sm:items-center sm:justify-center sm:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full h-full overflow-y-auto bg-navy-700 p-4 sm:h-auto sm:max-h-[92vh] sm:max-w-6xl sm:rounded-xl sm:border sm:border-navy-600 sm:p-6"
      >
        {header}

        {load.state === 'ready' && dots.length > 0 && full && (presets.length > 0 || zoomed) && (
          <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
            <span className="me-auto hidden text-[10px] text-gray-500 sm:block">{t('zoomHint')}</span>
            {presets.map((d) => {
              const preset = presetDomain(full, d)
              const on = domain != null && domain[0] === preset[0] && domain[1] === preset[1]
              return (
                <button key={d} type="button" onClick={() => setZoom(preset)} className={pill(on)} aria-pressed={on}>
                  {t('presetDays', { days: d })}
                </button>
              )
            })}
            <button type="button" onClick={() => setZoom(null)} className={pill(!zoomed)} aria-pressed={!zoomed}>
              {t('rangeAll')}
            </button>
          </div>
        )}

        <div ref={boxRef} className="w-full">
          {body}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={LINE_COLOR} strokeWidth="2" strokeDasharray="4 2" />
            </svg>
            {t('legendLine')}
          </span>
          {(['yes', 'no', 'neutral'] as const).map((side) => (
            <span key={side} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SIDE_COLOR[side] }} aria-hidden="true" />
              {tSources(SIDE_VOTE_KEY[side])}
            </span>
          ))}
          <span className="text-gray-500">{t('legendSize')}</span>
        </div>

        <p data-testid="article-dots-caption" className="mt-3 text-xs leading-relaxed text-gray-400">
          {t('caption')}
        </p>
      </div>
    </div>,
    document.body,
  )
}
