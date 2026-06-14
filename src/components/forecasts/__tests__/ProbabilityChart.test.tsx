import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProbabilityChart from '../ProbabilityChart'

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
        polymarketSnapshots={[
          { createdAt: '2026-06-01', probability: 60 },
          { createdAt: '2026-06-02', probability: 65 },
        ]}
      />,
    )
    expect(screen.getByText(HEADING)).toBeInTheDocument()
  })

  it('does not render the market line for multiple-choice forecasts', () => {
    // Market history is binary; an MC forecast with <3 commitments stays hidden.
    render(
      <ProbabilityChart
        commitments={[]}
        snapshots={[]}
        outcomeType="MULTIPLE_CHOICE"
        options={[{ id: 'a', text: 'A' }]}
        polymarketSnapshots={[{ createdAt: '2026-06-01', probability: 60 }]}
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
        polymarketSnapshots={[{ createdAt: '2026-06-01', probability: 60 }]}
      />,
    )
    expect(screen.queryByText(HEADING)).toBeNull()
  })
})
