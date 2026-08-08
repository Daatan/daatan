import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import BotsTable from '../BotsTable'
import type { Bot } from '../_bots/types'

// Mock next-intl to avoid NextIntlClientProvider requirement. Resolve real
// en.json values so translated strings render as English in assertions.
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

const testBot = (overrides: Partial<Bot> = {}): Bot => ({
  id: 'bot-1',
  isActive: true,
  intervalMinutes: 60,
  maxForecastsPerDay: 5,
  maxVotesPerDay: 5,
  stakeMin: 1,
  stakeMax: 5,
  modelPreference: 'default',
  hotnessMinSources: 2,
  hotnessWindowHours: 24,
  personaPrompt: '',
  forecastPrompt: '',
  votePrompt: '',
  newsSources: ['https://example.com/feed'],
  activeHoursStart: null,
  activeHoursEnd: null,
  tagFilter: [],
  voteBias: 0,
  canCreateForecasts: true,
  canVote: true,
  autoApprove: false,
  requireApprovalForForecasts: false,
  enableSentimentExtraction: false,
  enableRejectionTracking: false,
  showMetadataOnForecast: false,
  maxForecastsPerHour: 0,
  lastRunAt: null,
  nextRunAt: null,
  forecastsToday: 0,
  votesToday: 0,
  lastLog: null,
  user: { id: 'u1', name: 'Bot One', username: 'bot_one' },
  ...overrides,
})

const mockFetch = vi.fn()

describe('BotsTable', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
  })

  it('shows the interim step label while a run is in flight, then clears it (daatan#1139)', async () => {
    let resolveRun!: (value: unknown) => void
    const runPromise = new Promise((resolve) => { resolveRun = resolve })

    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/bots') {
        return Promise.resolve({ ok: true, json: async () => ({ bots: [testBot()] }) })
      }
      if (url === '/api/tags') {
        return Promise.resolve({ ok: true, json: async () => ({ tags: [] }) })
      }
      if (url.includes('/run')) {
        return runPromise
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    render(<BotsTable />)

    await waitFor(() => expect(screen.getByText('Bot One')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Run now'))

    // Step-progress feedback replaces the bare spinner: the first calibrated
    // step label appears while the blocking run request is still pending.
    await waitFor(() => {
      expect(screen.getByText('Fetching feeds…')).toBeInTheDocument()
    })

    await act(async () => {
      resolveRun({
        ok: true,
        json: async () => ({
          summary: {
            botId: 'bot-1',
            botName: 'Bot One',
            forecastsCreated: 1,
            votes: 0,
            skipped: 0,
            errors: 0,
            dryRun: false,
            gatedByActiveHours: false,
          },
        }),
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Fetching feeds…')).not.toBeInTheDocument()
    })
  })

  it('re-enables the run buttons once the run request settles', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/bots') {
        return Promise.resolve({ ok: true, json: async () => ({ bots: [testBot()] }) })
      }
      if (url === '/api/tags') {
        return Promise.resolve({ ok: true, json: async () => ({ tags: [] }) })
      }
      if (url.includes('/run')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            summary: {
              botId: 'bot-1', botName: 'Bot One', forecastsCreated: 0, votes: 0,
              skipped: 0, errors: 0, dryRun: false, gatedByActiveHours: false,
            },
          }),
        })
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    render(<BotsTable />)
    await waitFor(() => expect(screen.getByText('Bot One')).toBeInTheDocument())

    const runButton = screen.getByTitle('Run now')
    fireEvent.click(runButton)

    await waitFor(() => expect(runButton).toBeDisabled())
    await waitFor(() => expect(runButton).not.toBeDisabled())
    expect(screen.queryByText('Fetching feeds…')).not.toBeInTheDocument()
  })
})
