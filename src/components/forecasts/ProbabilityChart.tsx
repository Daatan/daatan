'use client'

import { useState } from 'react'
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
}

const OPTION_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4']

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

export default function ProbabilityChart({
  commitments,
  snapshots,
  outcomeType,
  options,
  marketSnapshots = [],
  marketLabel = 'Market (Polymarket)',
}: Props) {
  // `picked` is the user's explicit range choice; null → use the data-driven default.
  // `brush` tracks manual brush dragging, so presets and fine control coexist.
  const [picked, setPicked] = useState<RangeKey | null>(null)
  const [brush, setBrush] = useState<{ s: number; e: number } | null>(null)
  // Drag-to-zoom: the two timestamps under the pointer while a selection is in
  // progress. Both null when not dragging; they drive the live ReferenceArea.
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)

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
  if (commitments.length < 3 && !showMarket && !showAiHistory) return null

  const sortedCommits = [...commitments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const sortedSnaps = snapshots
    .filter(s => s.externalProbability != null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const sortedMarket = [...marketSnapshots].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  // One data point per event (commitment, Oracle run, or market snapshot), sorted chronologically
  const allTs = [
    ...sortedCommits.map(c => new Date(c.createdAt).getTime()),
    ...sortedSnaps.map(s => new Date(s.createdAt).getTime()),
    ...sortedMarket.map(m => new Date(m.createdAt).getTime()),
  ].sort((a, b) => a - b)
  const uniqueTs = [...new Set(allTs)]

  const data = uniqueTs.map(ts => {
    const upToCommits = sortedCommits.filter(c => new Date(c.createdAt).getTime() <= ts)
    const upToSnaps = sortedSnaps.filter(s => new Date(s.createdAt).getTime() <= ts)
    // Carry AI estimate forward as a step function
    const latestAi = upToSnaps.length > 0 ? upToSnaps[upToSnaps.length - 1].externalProbability : null

    const upToMarket = sortedMarket.filter(m => new Date(m.createdAt).getTime() <= ts)
    const latestMarket = upToMarket.length > 0 ? upToMarket[upToMarket.length - 1].probability : null

    const point: Record<string, number | string | null> = {
      ts,
      ai: latestAi ?? null,
      market: latestMarket,
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
  // The AI and market series carry their last value forward as a step function, so a
  // single Oracle estimate (or market snapshot) dated AFTER all commitments yields one
  // non-null point at the right edge — with no segment to draw and dots off (because the
  // commitments made `data` dense), it's invisible. Decide dots per series by how many
  // real points each has, so a lone estimate always shows as a marker.
  const showAiDots = aiPointCount <= 5
  const showMarketDots = sortedMarket.length <= 5

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
    if (typeof s?.activeLabel === 'number') { setDragStart(s.activeLabel); setDragEnd(s.activeLabel) }
  }
  const onDragMove = (s: { activeLabel?: number | string } | null) => {
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
    <div className="mb-8 bg-navy-700 border border-navy-600 rounded-xl p-4 sm:p-6">
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
                  range === r.key ? 'bg-navy-600 text-white' : 'text-gray-500 hover:text-gray-300'
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
              dot={showAiDots}
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
              dot={showMarketDots}
              connectNulls
            />
          )}

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
