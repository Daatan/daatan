import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ForecastWizard } from '../ForecastWizard'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

// Mock analytics to avoid noise
vi.mock('@/lib/analytics', () => ({ analytics: { forecastCreated: vi.fn() } }))

// Mock next-intl to avoid NextIntlClientProvider requirement.
// Resolve real en.json values so the wizard's translated strings render as
// English in assertions (with basic {var} interpolation).
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
    t.rich = (key: string) => dict[key] ?? key
    return t
  }
  return { useTranslations: (ns: string) => translator(ns), useLocale: () => 'en' }
})

/** Render the wizard with step 4 active and controllable formData via sessionStorage. */
async function renderAtStep4(overrides: Record<string, unknown> = {}) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const draft = {
    formData: {
      claimText: 'This is a valid claim for testing purposes',
      tags: [],
      outcomeType: 'BINARY',
      resolveByDatetime: tomorrow.toISOString().split('T')[0],
      resolutionRules: 'Resolved YES if confirmed by two credible sources.',
      isPublic: true,
      ...overrides,
    },
    currentStep: 4,
  }
  sessionStorage.setItem('daatan:forecast-draft', JSON.stringify(draft))
  await act(async () => { render(<ForecastWizard isExpressFlow={false} />) })
}

describe('ForecastWizard', () => {
  beforeEach(() => {
    // Clear localStorage and sessionStorage before each test
    localStorage.clear()
    sessionStorage.clear()
    // Clear URL search params
    delete (window as any).location
      ; (window as any).location = { search: '' }
  })

  it('renders with empty form by default', () => {
    render(<ForecastWizard />)
    expect(screen.getByText('News Anchor')).toBeInTheDocument()
  })

  it('loads express forecast data from localStorage on mount', async () => {
    const expressData = {
      claimText: 'Bitcoin will reach $100k',
      resolveByDatetime: '2026-12-31T23:59:59Z',
      detailsText: 'Bitcoin has been rising',
      tags: ['Crypto', 'Finance'],
      resolutionRules: 'Resolved by CoinMarketCap',
      newsAnchor: {
        url: 'https://example.com/article',
        title: 'Bitcoin News',
        snippet: 'Bitcoin is booming'
      },
    }

    localStorage.setItem('expressPredictionData', JSON.stringify(expressData))

    await act(async () => {
      render(<ForecastWizard isExpressFlow={true} />)
    })

    // Data should be removed from localStorage after loading
    await waitFor(() => {
      expect(localStorage.getItem('expressPredictionData')).toBeNull()
    })
  })

  it('does not load data when not from express', () => {
    const expressData = {
      claimText: 'Bitcoin will reach $100k',
      resolveByDatetime: '2026-12-31T23:59:59Z',
      tags: ['Crypto'],
    }

    localStorage.setItem('expressPredictionData', JSON.stringify(expressData))

    render(<ForecastWizard isExpressFlow={false} />)

    // Data should remain in localStorage
    expect(localStorage.getItem('expressPredictionData')).toBeTruthy()
  })

  it('handles invalid JSON in localStorage gracefully', () => {
    localStorage.setItem('expressPredictionData', 'invalid json')

    // Should not throw
    expect(() => render(<ForecastWizard isExpressFlow={true} />)).not.toThrow()
  })

  it('handles missing localStorage data gracefully', () => {
    // Should not throw
    expect(() => render(<ForecastWizard isExpressFlow={true} />)).not.toThrow()
  })

  it('restores form data from sessionStorage on mount (manual flow)', async () => {
    const draft = {
      formData: {
        claimText: 'Restored claim text',
        tags: [],
        outcomeType: 'BINARY',
        resolveByDatetime: '',
        isPublic: true,
      },
      currentStep: 2,
    }
    sessionStorage.setItem('daatan:forecast-draft', JSON.stringify(draft))

    await act(async () => {
      render(<ForecastWizard isExpressFlow={false} />)
    })

    // Should be on step 2 (Prediction) with the claim text visible in the input
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/Bitcoin will reach/i) as HTMLInputElement
      expect(input.value).toBe('Restored claim text')
    })
  })

  it('does not restore sessionStorage in express flow', async () => {
    const draft = {
      formData: { claimText: 'Should not appear', tags: [], outcomeType: 'BINARY', resolveByDatetime: '', isPublic: true },
      currentStep: 2,
    }
    sessionStorage.setItem('daatan:forecast-draft', JSON.stringify(draft))

    await act(async () => {
      render(<ForecastWizard isExpressFlow={true} />)
    })

    // sessionStorage data should be ignored in express flow
    expect(screen.queryByDisplayValue('Should not appear')).toBeNull()
  })

  it('handles corrupt sessionStorage data gracefully', () => {
    sessionStorage.setItem('daatan:forecast-draft', 'not valid json {{{')
    expect(() => render(<ForecastWizard isExpressFlow={false} />)).not.toThrow()
  })

  // ── Submit guard (stale draft protection) ────────────────────────────────

  describe('submit guard — publish with stale/incomplete draft', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('navigates to step 2 and shows error when claimText is too short', async () => {
      await renderAtStep4({ claimText: 'short' })
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })
      await waitFor(() => {
        expect(screen.getByText(/prediction claim must be at least 10 characters/i)).toBeInTheDocument()
        // Step 2 heading should be visible
        expect(screen.getByRole('heading', { name: /write your forecast/i })).toBeInTheDocument()
      })
      // fetch should NOT have been called
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('navigates to step 3 and shows error when resolutionRules is missing', async () => {
      await renderAtStep4({ resolutionRules: undefined })
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })
      await waitFor(() => {
        expect(screen.getByText(/resolution rules are required/i)).toBeInTheDocument()
      })
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('navigates to step 3 and shows error when resolutionRules is too short', async () => {
      await renderAtStep4({ resolutionRules: 'short' })
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })
      await waitFor(() => {
        expect(screen.getByText(/resolution rules are required/i)).toBeInTheDocument()
      })
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('navigates to step 3 and shows error when resolveByDatetime is in the past', async () => {
      await renderAtStep4({ resolveByDatetime: '2020-01-01' })
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })
      await waitFor(() => {
        // Error banner (bg-red-900) and StepOutcome inline validation may both show this text
        const matches = screen.getAllByText(/resolution date must be in the future/i)
        expect(matches.length).toBeGreaterThan(0)
      })
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('navigates to step 3 and shows error when resolveByDatetime is missing', async () => {
      await renderAtStep4({ resolveByDatetime: '' })
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })
      await waitFor(() => {
        expect(screen.getByText(/resolution date must be in the future/i)).toBeInTheDocument()
      })
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('calls fetch when all required fields are valid', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-1', slug: 'test-slug' }),
      } as Response)
      // Second call for /publish
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)

      await renderAtStep4()
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })

      await waitFor(() => {
        expect(vi.mocked(fetch)).toHaveBeenCalled()
        const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
        expect(body.resolutionRules).toBeDefined()
        expect(body.claimText).toBeDefined()
      })
    })

    it('navigates to correct step when server returns field validation details', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Validation failed: resolutionRules (Resolution rules must be at least 10 characters)',
          details: [{ path: ['resolutionRules'], message: 'Resolution rules must be at least 10 characters' }],
        }),
      } as Response)

      await renderAtStep4()
      const publishBtn = screen.getAllByRole('button', { name: /publish/i }).at(-1)!
      await act(async () => { fireEvent.click(publishBtn) })

      await waitFor(() => {
        expect(screen.getByText(/validation failed/i)).toBeInTheDocument()
      })
    })

    it('skips publish guard when saving as draft', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-1', slug: 'draft-slug' }),
      } as Response)

      await renderAtStep4({ resolutionRules: undefined, claimText: 'ok' })
      const draftBtn = screen.getByRole('button', { name: /save draft/i })
      await act(async () => { fireEvent.click(draftBtn) })

      // fetch should be called even with missing fields (draft allows partial saves)
      await waitFor(() => {
        expect(vi.mocked(fetch)).toHaveBeenCalled()
      })
    })
  })

  it('converts ISO datetime to YYYY-MM-DD for the date input in express flow', async () => {
    const expressData = {
      claimText: 'Test prediction claim text',
      resolveByDatetime: '2026-12-31T23:59:59.000Z',
      detailsText: 'Some details',
      tags: ['AI'],
      resolutionRules: 'Check official sources',
      newsAnchor: {
        url: 'https://example.com',
        title: 'Article',
        snippet: 'Snippet',
      },
    }

    localStorage.setItem('expressPredictionData', JSON.stringify(expressData))

    await act(async () => {
      render(<ForecastWizard isExpressFlow={true} />)
    })

    // Navigate to step 3 (Outcome) where the date input is
    const nextButton = screen.getByRole('button', { name: /next/i })
    
    await act(async () => {
      fireEvent.click(nextButton)
    })

    await waitFor(() => {
      const dateInput = screen.getByLabelText(/Resolution Date/i) as HTMLInputElement
      // Should be YYYY-MM-DD, not the full ISO string
      expect(dateInput.value).toBe('2026-12-31')
    })
  })
})
