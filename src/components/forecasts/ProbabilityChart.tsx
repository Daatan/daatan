'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceArea,
} from 'recharts'
// Canonical community-probability lives in @/lib/forecast-math so the feed card
// and this chart agree. Re-exported below for existing importers.
import { communityProbability } from '@/lib/forecast-math'

type ChartSnapshot = {
  createdAt: string
  externalProbability?: number | null
  /** 'evidence' (default) | 'clock' — clock rows are the daily glide requote;
   *  they draw the AI line's movement but get a hollow dot, not a filled one. */
  kind?: string
}

type ChartCommitment = {
  createdAt: string
  cuCommitted: number
  binaryChoice?: boolean | null
  option?: { id: string } | null
}

type ChartOption = {
  id: string
  text: string
}

type ChartMarketPoint = {
  createdAt: string
  probability: number
}

/** One AI-panel member's estimate history (docs/AI_PANEL.md §8). A hidden, opt-in
 *  source: rendered only when the viewer enabled it in Settings, as dashed lines
 *  distinct from the solid Oracle `ai` line, which it never touches. */
type ChartPanelMember = {
  model: string
  label: string
  color: string
  isControl: boolean
  points: { createdAt: string; probability: number }[]
}

type Props = {
  commitments: ChartCommitment[]
  snapshots: ChartSnapshot[]
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'NUMERIC_THRESHOLD'
  options: ChartOption[]
  /** Linked external-market price history, oldest first, already polarity-adjusted
   *  by the caller (see marketDisplayProbability). Drives the "Market" line. */
  marketSnapshots?: ChartMarketPoint[]
  /** Legend name for the market line, e.g. "Market (Polymarket, inverted)". */
  marketLabel?: string
  /** Per-member AI-panel series. Only rendered when `showAiPanel` is true. */
  panelSeries?: ChartPanelMember[]
  /** The viewer opted into the AI panel in Settings. Off by default. */
  showAiPanel?: boolean
}

const OPTION_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4']

/** Renders a dot only at a real market-price change (see `marketChanged`), so a
 *  re-synced-but-unchanged price doesn't draw a redundant marker on the flat
 *  stretch between changes. */
function MarketDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { marketChanged?: boolean } }) {
  if (cx == null || cy == null || !payload?.marketChanged) return null
  return <circle className="market-price-dot" cx={cx} cy={cy} r={3} fill="#EC4899" stroke="none" />
}

/** Marks only real AI snapshot events (not carried step values): evidence runs
 *  get a filled dot, clock (glide) requotes a hollow one — arithmetic movement
 *  is visible on the line but doesn't masquerade as a news event. */
export function AiDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { aiEvent?: string | null } }) {
  if (cx == null || cy == null || !payload?.aiEvent) return null
  if (payload.aiEvent === 'clock') {
    return <circle className="ai-clock-dot" cx={cx} cy={cy} r={2.5} fill="#1A202C" stroke="#FBBF24" strokeWidth={1.5} />
  }
  return <circle className="ai-evidence-dot" cx={cx} cy={cy} r={3} fill="#FBBF24" stroke="none" />
}

// Axis ticks show the date; the tooltip header adds the time so events on the
// same day (which previously collapsed to one ambiguous label) are distinct.
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
// On a tight (last-day) window the date alone repeats on every tick, so show the hour instead.
const fmtHour = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric' })

const DAY_MS = 86_400_000
type RangeKey = '24h' | '7d' | 'all'
const RANGES: { key: RangeKey; label: string; span: number }[] = [
  { key: '24h', label: '24h', span: DAY_MS },
  { key: '7d', label: '7d', span: 7 * DAY_MS },
  { key: 'all', label: 'All', span: Infinity },
]

export { communityProbability }

/**
 * Map a [lo, hi] timestamp window (e.g. a drag selection) onto inclusive brush
 * indices into a time-ascending `tsList`. Returns null when the window is too
 * narrow to be a deliberate zoom (fewer than two points) so a stray click is
 * treated as a no-op rather than collapsing the chart.
 */
export function tsWindowToIndices(
  tsList: number[],
  lo: number,
  hi: number,
): { s: number; e: number } | null {
  if (lo > hi) [lo, hi] = [hi, lo]
  let s = tsList.findIndex(t => t >= lo)
  if (s < 0) s = 0
  let e = -1
  for (let i = tsList.length - 1; i >= 0; i--) {
    if (tsList[i] <= hi) { e = i; break }
  }
  if (e < 0) e = tsList.length - 1
  return e - s >= 1 ? { s, e } : null
}

/**
 * Carry a market's price forward across a merged timeline as a step function
 * (one entry per `ts`), flagging only the points where the price is a genuine
 * change from the prior point. A market re-synced every cron tick re-confirms
 * the same price far more often than it actually moves, so without this flag
 * every tick would draw its own chart dot.
 */
export function buildMarketSeries(
  sortedMarket: { createdAt: string; probability: number }[],
  tsList: number[],
): { market: number | null; marketChanged: boolean }[] {
  let prev: number | null = null
  return tsList.map(ts => {
    const upTo = sortedMarket.filter(m => new Date(m.createdAt).getTime() <= ts)
    const latest = upTo.length > 0 ? upTo[upTo.length - 1].probability : null
    const marketChanged = latest != null && latest !== prev
    prev = latest ?? prev
    return { market: latest, marketChanged }
  })
}

/** Sanitised, collision-free dataKey for a member's step series on the merged data. */
export function panelKey(model: string): string {
  return 'panel_' + model.replace(/[^a-zA-Z0-9]/g, '_')
}

/** Carry each member's estimate forward as a step function across the merged timeline,
 *  exactly as the Oracle `ai` line does — an unchanged input yields an unchanged number
 *  (temperature 0), so a flat stretch between real updates is correct, not missing data. */
export function buildPanelSeries(
  members: ChartPanelMember[],
  tsList: number[],
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {}
  for (const m of members) {
    const sorted = [...m.points].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    out[panelKey(m.model)] = tsList.map((ts) => {
      const upTo = sorted.filter((p) => new Date(p.createdAt).getTime() <= ts)
      return upTo.length > 0 ? upTo[upTo.length - 1].probability : null
    })
  }
  return out
}

export default function ProbabilityChart({
  commitments,
  snapshots,
  outcomeType,
  options,
  marketSnapshots = [],
  marketLabel = 'Market (Polymarket)',
  panelSeries = [],
  showAiPanel = false,
}: Props) {
  // `picked` is the user's explicit range choice; null → use the data-driven default.
  // `brush` tracks manual brush dragging, so presets and fine control coexist.
  const [picked, setPicked] = useState<RangeKey | null>(null)
  const [brush, setBrush] = useState<{ s: number; e: number } | null>(null)
  // Drag-to-zoom: the two timestamps under the pointer while a selection is in
  // progress. Both null when not dragging; they drive the live ReferenceArea.
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)

  // Hover-triggered tooltips have no built-in close affordance — on touch devices
  // especially, a tapped-open tooltip has no "mouse leave" to hide it again. Any
  // click/tap outside the card force-closes it (via Tooltip's `active` override);
  // moving or tapping back inside re-arms normal hover behavior.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [tooltipDismissed, setTooltipDismissed] = useState(false)
  useEffect(() => {
    const handleOutside = (e: Event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setTooltipDismissed(true)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  if (outcomeType === 'NUMERIC_THRESHOLD') return null

  // The market YES price is a binary probability, so we only plot it on binary
  // forecasts. When a linked market has history we render the chart even with
  // <3 commitments, so the market line shows before the community moves.
  const showMarket = outcomeType === 'BINARY' && marketSnapshots.length > 0
  // Likewise render once there are ≥2 AI (Oracle) updates, so a forecast with an
  // estimate trend shows the chart even before the community has moved. Two points
  // is the minimum that draws a line (a single estimate is just a dot).
  const aiPointCount = snapshots.filter(s => s.externalProbability != null).length
  const showAiHistory = aiPointCount >= 2
  // A viewer who opted into the panel gets the chart as soon as the panel has any point,
  // even on a forecast with no commitments/Oracle/market yet.
  const hasPanelData = showAiPanel && panelSeries.some(m => m.points.length > 0)
  if (commitments.length < 3 && !showMarket && !showAiHistory && !hasPanelData) return null

  const sortedCommits = [...commitments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const sortedSnaps = snapshots
    .filter(s => s.externalProbability != null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const sortedMarket = [...marketSnapshots].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  // Members are drawn only when the viewer opted in AND at least one has a point.
  const panelMembers = showAiPanel ? panelSeries.filter(m => m.points.length > 0) : []
  const panelTs = panelMembers.flatMap(m => m.points.map(p => new Date(p.createdAt).getTime()))

  // One data point per event (commitment, Oracle run, market snapshot, or panel run), sorted chronologically
  const allTs = [
    ...sortedCommits.map(c => new Date(c.createdAt).getTime()),
    ...sortedSnaps.map(s => new Date(s.createdAt).getTime()),
    ...sortedMarket.map(m => new Date(m.createdAt).getTime()),
    ...panelTs,
  ].sort((a, b) => a - b)
  const uniqueTs = [...new Set(allTs)]
  const marketSeries = buildMarketSeries(sortedMarket, uniqueTs)
  const panelStep = buildPanelSeries(panelMembers, uniqueTs)

  const data = uniqueTs.map((ts, i) => {
    const upToCommits = sortedCommits.filter(c => new Date(c.createdAt).getTime() <= ts)
    const upToSnaps = sortedSnaps.filter(s => new Date(s.createdAt).getTime() <= ts)
    // Carry AI estimate forward as a step function
    const latestAi = upToSnaps.length > 0 ? upToSnaps[upToSnaps.length - 1].externalProbability : null

    const { market: latestMarket, marketChanged } = marketSeries[i]

    // The snapshot exactly at this timestamp (if any) — drives the AiDot so
    // markers appear at real AI events only, styled by evidence vs clock.
    const snapAt = sortedSnaps.filter(s => new Date(s.createdAt).getTime() === ts).pop()

    const point: Record<string, number | string | boolean | null> = {
      ts,
      ai: latestAi ?? null,
      aiEvent: snapAt ? (snapAt.kind === 'clock' ? 'clock' : 'evidence') : null,
      market: latestMarket,
      marketChanged,
    }

    for (const m of panelMembers) {
      point[panelKey(m.model)] = panelStep[panelKey(m.model)][i]
    }

    if (outcomeType === 'BINARY') {
      const community = communityProbability(upToCommits)
      if (community != null) point.community = community
    } else {
      // MULTIPLE_CHOICE: rolling share per option
      for (const opt of options) {
        const count = upToCommits.filter(c => c.option?.id === opt.id).length
        point[opt.id] = upToCommits.length > 0 ? Math.round((count / upToCommits.length) * 100) : null
      }
    }

    return point
  })

  // A line with few data points draws a barely-visible (or zero-length) segment,
  // so a sparse forecast — e.g. two same-day Oracle estimates, or a lone market
  // snapshot — would read as an empty chart. Render point markers while the series
  // is sparse so each value is legible; drop them once the trend is dense.
  const showDots = data.length <= 5
  // The AI series carries its last value forward as a step function, so a single
  // Oracle estimate dated AFTER all commitments yields one non-null point at the
  // right edge — with no segment to draw and dots off (because the commitments
  // made `data` dense), it's invisible. Decide dots by how many real points the
  // series has, so a lone estimate always shows as a marker.
  const showAiDots = aiPointCount <= 5

  // Range presets drive the brush window (which zooms the chart). Default to the
  // tightest preset that still shows ≥2 points, so the chart opens on recent
  // activity without going blank; the brush stays underneath for fine control.
  const showPresets = data.length > 2
  const maxTs = data.length ? (data[data.length - 1].ts as number) : 0
  const minTs = data.length ? (data[0].ts as number) : 0
  const pointsWithin = (span: number) => data.filter(d => (d.ts as number) >= maxTs - span).length
  const defaultRange: RangeKey =
    maxTs - minTs <= DAY_MS ? 'all'
    : pointsWithin(DAY_MS) >= 2 ? '24h'
    : pointsWithin(7 * DAY_MS) >= 2 ? '7d'
    : 'all'
  const range = picked ?? defaultRange
  const rangeSpan = RANGES.find(r => r.key === range)!.span
  const presetStart =
    range === 'all' ? 0 : Math.max(0, data.findIndex(d => (d.ts as number) >= maxTs - rangeSpan))
  const brushStart = brush ? brush.s : presetStart
  const brushEnd = brush ? brush.e : data.length - 1

  // Drag-to-zoom over the plot. recharts hands each mouse event the x value under
  // the pointer as `activeLabel` (our `ts`). We track the drag span as a live
  // ReferenceArea, then on release map it to brush indices so it zooms exactly
  // like the brush/preset path. Double-click clears back to the default window.
  const onDragStart = (s: { activeLabel?: number | string } | null) => {
    setTooltipDismissed(false)
    if (typeof s?.activeLabel === 'number') { setDragStart(s.activeLabel); setDragEnd(s.activeLabel) }
  }
  const onDragMove = (s: { activeLabel?: number | string } | null) => {
    setTooltipDismissed(false)
    if (dragStart != null && typeof s?.activeLabel === 'number') setDragEnd(s.activeLabel)
  }
  const onDragEnd = () => {
    if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
      const window = tsWindowToIndices(data.map(d => d.ts as number), dragStart, dragEnd)
      if (window) setBrush(window)
    }
    setDragStart(null); setDragEnd(null)
  }
  const resetZoom = () => { setBrush(null); setPicked(null); setDragStart(null); setDragEnd(null) }

  return (
    <div ref={wrapperRef} className="mb-8 bg-navy-700 border border-navy-600 rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
          Probability over time
        </h3>
        {showPresets && (
          <div className="flex items-center gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => { setPicked(r.key); setBrush(null) }}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
                  range === r.key ? 'bg-cobalt text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240} className="select-none">
        <LineChart
          data={data}
          margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
          onMouseDown={onDragStart}
          onMouseMove={onDragMove}
          onMouseUp={onDragEnd}
          onMouseLeave={() => { setDragStart(null); setDragEnd(null) }}
          onDoubleClick={resetZoom}
          style={{ cursor: 'crosshair' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={range === '24h' ? fmtHour : fmtDate}
            tick={{ fill: '#718096', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: '#718096', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
            width={36}
          />
          <Tooltip
            active={tooltipDismissed ? false : undefined}
            contentStyle={{
              backgroundColor: '#1A202C',
              border: '1px solid #2D3748',
              borderRadius: '8px',
              fontSize: 12,
            }}
            labelStyle={{ color: '#A0AEC0' }}
            labelFormatter={(ts) => (typeof ts === 'number' ? fmtDateTime(ts) : ts)}
            formatter={(value, name) => [typeof value === 'number' ? `${Math.round(value)}%` : value, name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#A0AEC0', paddingTop: '8px' }} />

          {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
            <ReferenceArea
              x1={Math.min(dragStart, dragEnd)}
              x2={Math.max(dragStart, dragEnd)}
              strokeOpacity={0.3}
              fill="#63B3ED"
              fillOpacity={0.15}
            />
          )}

          {outcomeType === 'BINARY' && (
            <Line
              type="monotone"
              dataKey="community"
              name="Community"
              stroke="#A0AEC0"
              strokeWidth={2}
              dot={showDots}
              connectNulls
            />
          )}

          {outcomeType === 'MULTIPLE_CHOICE' && options.map((opt, i) => (
            <Line
              key={opt.id}
              type="monotone"
              dataKey={opt.id}
              name={opt.text}
              stroke={OPTION_COLORS[i % OPTION_COLORS.length]}
              strokeWidth={2}
              dot={showDots}
              connectNulls
            />
          ))}

          {sortedSnaps.length > 0 && (
            <Line
              type="stepAfter"
              dataKey="ai"
              name="AI (Oracle)"
              stroke="#FBBF24"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={showAiDots ? <AiDot /> : false}
              connectNulls
            />
          )}

          {showMarket && (
            <Line
              type="stepAfter"
              dataKey="market"
              name={marketLabel}
              stroke="#EC4899"
              strokeWidth={2}
              dot={<MarketDot />}
              connectNulls
            />
          )}

          {/* AI-panel member lines (docs/AI_PANEL.md §8): thinner, finer-dashed and
              semi-transparent so they read as a secondary, experimental source and never
              compete with the Oracle line. */}
          {panelMembers.map(m => (
            <Line
              key={m.model}
              type="stepAfter"
              dataKey={panelKey(m.model)}
              name={m.isControl ? `${m.label} (control)` : m.label}
              stroke={m.color}
              strokeOpacity={0.75}
              strokeWidth={1.5}
              strokeDasharray="2 3"
              dot={false}
              connectNulls
            />
          ))}

          {showPresets && (
            <Brush
              dataKey="ts"
              height={20}
              stroke="#4A5568"
              fill="#1A202C"
              travellerWidth={8}
              startIndex={brushStart}
              endIndex={brushEnd}
              onChange={(r: { startIndex?: number; endIndex?: number }) => {
                if (r.startIndex != null && r.endIndex != null) setBrush({ s: r.startIndex, e: r.endIndex })
              }}
              tickFormatter={(ts: number) => fmtDate(ts)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {showPresets && (
        <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-gray-600">
          <span>Drag across the chart to zoom · double-click to reset</span>
          {brush && (
            <button onClick={resetZoom} className="text-gray-500 hover:text-gray-300 font-medium">
              Reset zoom
            </button>
          )}
        </div>
      )}
    </div>
  )
}
