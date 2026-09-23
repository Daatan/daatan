import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoresGrid } from '@/components/profile/ScoresGrid'
import type { ProfileScores } from '@/lib/services/profile'

// Real English messages, so a missing or misspelled i18n key fails here
// instead of throwing in the server component at request time.
vi.mock('next-intl/server', async () => {
  const en = (await import('../../../../messages/en.json')).default
  const ns = en.profile as Record<string, string>
  const t = (key: string, vars: Record<string, string | number> = {}) => {
    const raw = ns[key]
    if (raw === undefined) throw new Error(`Missing profile.${key}`)
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw)
  }
  return { getTranslations: () => Promise.resolve(t) }
})

vi.mock('@/components/profile/CalibrationChart', () => ({
  CalibrationChart: () => <div data-testid="calibration" />,
}))

const base: ProfileScores = {
  elo: 1500,
  avgBrierScore: null,
  brierCount: 0,
  peerScoreSum: 1.2,
  peerScoreCount: 4,
  aiScoreSum: 0.3,
  aiScoreCount: 4,
  rsTagDelta: null,
  truthScore: 0.1,
  weightedPeerScore: 0.2,
  weightedPeerCount: 4,
  roi: 2.5,
  accuracy: null,
  accuracyResolved: 1,
  topicBreakdown: [{ name: 'Politics', slug: 'politics', count: 3, peerScoreAvg: 0.1 }],
  calibration: [],
}

describe('ScoresGrid', () => {
  it('renders only Accuracy and Brier, with placeholders and explanations when there is no data', async () => {
    render(await ScoresGrid({ scores: base, tagName: null }))

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('Brier Score')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText(/need 2 more resolved/i)).toBeInTheDocument()
    expect(screen.getByText(/enter a % estimate/i)).toBeInTheDocument()
    expect(screen.getByText(/ignores how confident you were/i)).toBeInTheDocument()
    expect(screen.getByText(/0 is perfect/i)).toBeInTheDocument()

    for (const hidden of [/Peer/i, /ROI/, /TruthScore/, /Glicko/i, /Reputation/, /Politics/, /ELO/]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    }
  })

  it('renders values with the tag suffix and the calibration chart when data exists', async () => {
    const scores: ProfileScores = {
      ...base,
      accuracy: 0.667,
      accuracyResolved: 6,
      avgBrierScore: 0.187,
      brierCount: 6,
      calibration: [
        { predicted: 0.25, actual: 0.2, count: 3 },
        { predicted: 0.75, actual: 0.8, count: 3 },
      ],
    }
    render(await ScoresGrid({ scores, tagName: 'Politics' }))

    expect(screen.getByText('Accuracy · Politics')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('6 resolved')).toBeInTheDocument()
    expect(screen.getByText('Brier Score · Politics')).toBeInTheDocument()
    expect(screen.getByText('0.187')).toBeInTheDocument()
    expect(screen.getByTestId('calibration')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
