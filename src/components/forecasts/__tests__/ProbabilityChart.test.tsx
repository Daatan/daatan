import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProbabilityChart, { communityProbability } from '../ProbabilityChart'

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
