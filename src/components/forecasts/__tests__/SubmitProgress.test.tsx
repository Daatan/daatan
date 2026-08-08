import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubmitProgress, type ProgressStep } from '../SubmitProgress'

// Mock next-intl to avoid NextIntlClientProvider requirement. Resolve real
// en.json values so translated strings (e.g. "~Ns left") render as expected.
vi.mock('next-intl', async () => {
  const en = (await import('../../../../messages/en.json')).default
  const translator = (ns: string) => {
    const dict = ((en as Record<string, unknown>)[ns] ?? {}) as Record<string, string>
    const t = (key: string, vars?: Record<string, string | number>) => {
      let msg = dict[key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        }
      }
      return msg
    }
    return t
  }
  return { useTranslations: (ns: string) => translator(ns), useLocale: () => 'en' }
})

const steps: ProgressStep[] = [
  { key: 'fetch', label: 'Fetching feeds…', state: 'done' },
  { key: 'detect', label: 'Detecting topics…', state: 'active' },
  { key: 'generate', label: 'Generating forecasts…', state: 'pending' },
  { key: 'stake', label: 'Staking…', state: 'pending' },
]

describe('SubmitProgress', () => {
  it('renders a label for every step in order', () => {
    render(<SubmitProgress steps={steps} activeEstimateMs={5000} />)

    expect(screen.getByText('Fetching feeds…')).toBeInTheDocument()
    expect(screen.getByText('Detecting topics…')).toBeInTheDocument()
    expect(screen.getByText('Generating forecasts…')).toBeInTheDocument()
    expect(screen.getByText('Staking…')).toBeInTheDocument()
  })

  it('shows a countdown only next to the active step', () => {
    render(<SubmitProgress steps={steps} activeEstimateMs={5000} />)

    // "~Ns left" only renders once, alongside the active step.
    expect(screen.getAllByText(/left$/)).toHaveLength(1)
  })

  it('shows "Almost there…" once elapsed time overruns the estimate', () => {
    render(<SubmitProgress steps={steps} activeEstimateMs={0} />)

    expect(screen.getByText('Almost there…')).toBeInTheDocument()
  })

  it('renders no countdown/progress bar when no step is active', () => {
    const doneSteps: ProgressStep[] = steps.map((s) => ({ ...s, state: 'done' }))
    render(<SubmitProgress steps={doneSteps} activeEstimateMs={5000} />)

    expect(screen.queryByText(/left$/)).not.toBeInTheDocument()
    expect(screen.queryByText('Almost there…')).not.toBeInTheDocument()
  })

  it('renders a status region with aria-live for accessibility', () => {
    render(<SubmitProgress steps={steps} activeEstimateMs={5000} />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('supports an arbitrary step list, not just the fixed forecast-create/publish pair', () => {
    const custom: ProgressStep[] = [
      { key: 'a', label: 'Step A', state: 'done' },
      { key: 'b', label: 'Step B', state: 'done' },
      { key: 'c', label: 'Step C', state: 'active' },
      { key: 'd', label: 'Step D', state: 'pending' },
      { key: 'e', label: 'Step E', state: 'pending' },
    ]
    render(<SubmitProgress steps={custom} activeEstimateMs={2000} />)

    for (const s of custom) {
      expect(screen.getByText(s.label)).toBeInTheDocument()
    }
  })
})
