'use client'

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
} from 'recharts'

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
  /** Linked external-market YES-price history, oldest first. Drives the "Market" line. */
  marketSnapshots?: ChartMarketPoint[]
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

/**
 * Community probability for a binary forecast: the mean of committers' stated
 * estimates. Each commit's implied P(YES) is (cuCommitted + 100) / 200 — the
 * signed confidence stake (−100..100, so 0 → 50%, +100 → 100%, −100 → 0%).
 * This matches the canonical definition in commitment.ts
 * (communityProbabilityAtCommit). It is deliberately NOT a CU-weighted YES/NO
 * share, which over-reports consensus (a handful of all-YES stakes → 100%).
 * Returns a 0–100 integer, or null when there are no commitments.
 */
export function communityProbability(commits: { cuCommitted: number }[]): number | null {
  if (commits.length === 0) return null
  const mean = commits.reduce((sum, c) => sum + (c.cuCommitted + 100) / 200, 0) / commits.length
  return Math.round(mean * 100)
}

export default function ProbabilityChart({
  commitments,
  snapshots,
  outcomeType,
  options,
  marketSnapshots = [],
}: Props) {
  if (outcomeType === 'NUMERIC_THRESHOLD') return null

  // The market YES price is a binary probability, so we only plot it on binary
  // forecasts. When a linked market has history we render the chart even with
  // <3 commitments, so the market line shows before the community moves.
  const showMarket = outcomeType === 'BINARY' && marketSnapshots.length > 0
  // Likewise render once there are ≥3 AI (Oracle) updates, so a forecast with a
  // rich estimate history shows the chart even before the community has moved.
  const aiPointCount = snapshots.filter(s => s.externalProbability != null).length
  const showAiHistory = aiPointCount >= 3
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

  return (
    <div className="mb-8 bg-navy-700 border border-navy-600 rounded-xl p-4 sm:p-6">
      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
        Probability over time
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={fmtDate}
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

          {outcomeType === 'BINARY' && (
            <Line
              type="monotone"
              dataKey="community"
              name="Community"
              stroke="#A0AEC0"
              strokeWidth={2}
              dot={false}
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
              dot={false}
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
              dot={false}
              connectNulls
            />
          )}

          {showMarket && (
            <Line
              type="stepAfter"
              dataKey="market"
              name="Market (Polymarket)"
              stroke="#EC4899"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}

          {data.length > 2 && (
            <Brush
              dataKey="ts"
              height={20}
              stroke="#4A5568"
              fill="#1A202C"
              travellerWidth={8}
              tickFormatter={(ts: number) => fmtDate(ts)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
