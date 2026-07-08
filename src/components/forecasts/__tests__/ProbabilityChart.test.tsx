import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProbabilityChart, { AiDot, communityProbability, tsWindowToIndices, buildMarketSeries } from '../ProbabilityChart'

// recharts' ResponsiveContainer needs a sized box; stub it so children render in jsdom.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  }
})

function commitment(createdAt: string, binaryChoice: boolean, cu = 10) {
  return { createdAt, cuCommitted: cu, binaryChoice }
}

const HEADING = 'Probability over time'

describe('ProbabilityChart gating', () => {
  it('renders nothing with <3 commitments and no market history', () => {
    render(
      <ProbabilityChart
        commitments={[commitment('2026-06-01', true)]}
        snapshots={[]}
        outcomeType="BINARY"
        options={[]}
      />,
    )
    expect(screen.queryByText(HEADING)).toBeNull()
  })

  it('renders with ≥3 commitments', () => {
    render(
      <ProbabilityChart
        commitments={[
          commitment('2026-06-01', true),
          commitment('2026-06-02', false),
          commitment('2026-06-03', true),
        ]}
        snapshots={[]}
        outcomeType="BINARY"
        options={[]}
      />,
    )
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it('renders a binary forecast with market history even with <3 commitments', () => {
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[]}
        outcomeType="BINARY"
        options={[]}
        marketSnapshots={[
          { createdAt: '2026-06-01', probability: 60 },
          { createdAt: '2026-06-02', probability: 65 },
        ]}
      />,
    )
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it('renders with ≥2 AI updates even when there are <3 commitments', () => {
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[
          { createdAt: '2026-06-14T01:00:00Z', externalProbability: 40 },
          { createdAt: '2026-06-14T02:00:00Z', externalProbability: 55 },
        ]}
        outcomeType="BINARY"
        options={[]}
      />,
    )
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it('stays hidden with a single AI update and no commitments', () => {
    // One estimate is just a dot, not a trend — keep the chart hidden.
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[
          { createdAt: '2026-06-14T01:00:00Z', externalProbability: 40 },
        ]}
        outcomeType="BINARY"
        options={[]}
      />,
    )
    expect(screen.queryByText(HEADING)).toBeNull()
  })

  it('does not render the market line for multiple-choice forecasts', () => {
    // Market history is binary; an MC forecast with <3 commitments stays hidden.
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[]}
        outcomeType="MULTIPLE_CHOICE"
        options={[{ id: 'a', text: 'A' }]}
        marketSnapshots={[{ createdAt: '2026-06-01', probability: 60 }]}
      />,
    )
    expect(screen.queryByText(HEADING)).toBeNull()
  })

  it('never renders for numeric-threshold forecasts', () => {
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[]}
        outcomeType="NUMERIC_THRESHOLD"
        options={[]}
        marketSnapshots={[{ createdAt: '2026-06-01', probability: 60 }]}
      />,
    )
    expect(screen.queryByText(HEADING)).toBeNull()
  })
})

describe('communityProbability (mean of committers\' implied estimates)', () => {
  it('returns null with no commitments', () => {
    expect(communityProbability([])).toBeNull()
  })

  it('maps the signed stake to implied P(YES): +100 → 100, 0 → 50, −100 → 0', () => {
    expect(communityProbability([{ cuCommitted: 100 }])).toBe(100)
    expect(communityProbability([{ cuCommitted: 0 }])).toBe(50)
    expect(communityProbability([{ cuCommitted: -100 }])).toBe(0)
  })

  it('averages estimates rather than reporting a YES/NO share', () => {
    // Two YES stakes of differing confidence: mean(1.0, 0.6) = 0.8 → 80%.
    // The old CU-weighted share reported 100% here (both on the YES side).
    expect(communityProbability([{ cuCommitted: 100 }, { cuCommitted: 20 }])).toBe(80)
  })

  it('a YES and an opposing NO average toward the middle', () => {
    // mean(1.0, 0.0) = 0.5 → 50%
    expect(communityProbability([{ cuCommitted: 100 }, { cuCommitted: -100 }])).toBe(50)
  })

  it('three moderate YES stakes do not pin to 100%', () => {
    // mean of (0.75, 0.75, 0.75) = 0.75 → 75% (was 100% under the share formula)
    expect(communityProbability([{ cuCommitted: 50 }, { cuCommitted: 50 }, { cuCommitted: 50 }])).toBe(75)
  })
})

describe('buildMarketSeries (carry-forward + real-change flagging)', () => {
  it('flags the first appearance of a price as a change', () => {
    const out = buildMarketSeries([{ createdAt: '2026-07-01', probability: 20 }], [new Date('2026-07-01').getTime()])
    expect(out).toEqual([{ market: 20, marketChanged: true }])
  })

  it('does not re-flag a re-synced price that repeats the prior value', () => {
    const market = [
      { createdAt: '2026-07-01', probability: 20 },
      { createdAt: '2026-07-02', probability: 20 },
      { createdAt: '2026-07-03', probability: 20 },
      { createdAt: '2026-07-04', probability: 15 },
    ]
    const ts = market.map(m => new Date(m.createdAt).getTime())
    const out = buildMarketSeries(market, ts)
    expect(out.map(o => o.marketChanged)).toEqual([true, false, false, true])
    expect(out.map(o => o.market)).toEqual([20, 20, 20, 15])
  })

  it('carries the last value forward through ts points with no market snapshot at all', () => {
    const market = [{ createdAt: '2026-07-01', probability: 20 }]
    const ts = [new Date('2026-07-01').getTime(), new Date('2026-07-02').getTime()]
    const out = buildMarketSeries(market, ts)
    expect(out).toEqual([
      { market: 20, marketChanged: true },
      { market: 20, marketChanged: false },
    ])
  })
})

describe('tsWindowToIndices (drag-to-zoom span → brush indices)', () => {
  const ts = [0, 10, 20, 30, 40] // time-ascending

  it('maps an inner window to the enclosing inclusive indices', () => {
    expect(tsWindowToIndices(ts, 12, 33)).toEqual({ s: 2, e: 3 })
  })

  it('normalizes a right-to-left drag', () => {
    expect(tsWindowToIndices(ts, 33, 12)).toEqual({ s: 2, e: 3 })
  })

  it('clamps a window wider than the data to the full range', () => {
    expect(tsWindowToIndices(ts, -5, 999)).toEqual({ s: 0, e: 4 })
  })

  it('returns null for a window too narrow to span two points (a stray click)', () => {
    expect(tsWindowToIndices(ts, 11, 12)).toBeNull()
    expect(tsWindowToIndices(ts, 20, 20)).toBeNull()
  })
})

describe('AiDot (evidence vs clock markers)', () => {
  const renderDot = (payload?: { aiEvent?: string | null }) => {
    const { container } = render(
      <svg>
        <AiDot cx={10} cy={20} payload={payload} />
      </svg>,
    )
    return container
  }

  it('renders a filled dot at an evidence snapshot', () => {
    const container = renderDot({ aiEvent: 'evidence' })
    const dot = container.querySelector('circle.ai-evidence-dot')
    expect(dot).not.toBeNull()
    expect(dot!.getAttribute('fill')).toBe('#FBBF24')
  })

  it('renders a hollow dot at a clock (glide) requote', () => {
    const container = renderDot({ aiEvent: 'clock' })
    const dot = container.querySelector('circle.ai-clock-dot')
    expect(dot).not.toBeNull()
    expect(dot!.getAttribute('stroke')).toBe('#FBBF24')
    expect(dot!.getAttribute('fill')).not.toBe('#FBBF24')
  })

  it('renders nothing at carried step values (no snapshot at this timestamp)', () => {
    expect(renderDot({ aiEvent: null }).querySelector('circle')).toBeNull()
    expect(renderDot(undefined).querySelector('circle')).toBeNull()
  })
})

describe('clock snapshots in the chart series', () => {
  it('counts clock rows toward the ≥2-AI-updates gating (glide alone can draw the line)', () => {
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[
          { createdAt: '2026-07-01T00:00:00Z', externalProbability: 60, kind: 'evidence' },
          { createdAt: '2026-07-02T00:00:00Z', externalProbability: 59, kind: 'clock' },
          { createdAt: '2026-07-03T00:00:00Z', externalProbability: 58, kind: 'clock' },
        ]}
        outcomeType="BINARY"
        options={[]}
      />,
    )
    expect(screen.getByText(HEADING)).toBeTruthy()
  })
})
