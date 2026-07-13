import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import ExpressForecastClient, { type GeneratedPrediction } from '../ExpressForecastClient'
import messages from '../../../../../messages/en.json'

// Mock next/navigation
const mockRouter = {
  push: vi.fn(),
}

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)

describe('ExpressForecastClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders input form initially', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)
    expect(screen.getByText('Create a forecast')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe your event OR paste/)).toBeInTheDocument()
  })

  it('shows error for input less than 5 characters', async () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    const input = screen.getByPlaceholderText(/Describe your event OR paste/)
    const button = screen.getByText('Generate Forecast')

    fireEvent.change(input, { target: { value: 'abc' } })

    // Button should be disabled for input < 5 chars
    expect(button).toBeDisabled()
  })

  it('disables button when input is empty', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    const button = screen.getByText('Generate Forecast')
    expect(button).toBeDisabled()
  })

  it('enables button when input is valid', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    const input = screen.getByPlaceholderText(/Describe your event OR paste/)
    const button = screen.getByText('Generate Forecast')

    fireEvent.change(input, { target: { value: 'Bitcoin will reach $100k' } })

    expect(button).not.toBeDisabled()
  })

  it('shows character count', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    const input = screen.getByPlaceholderText(/Describe your event OR paste/)

    fireEvent.change(input, { target: { value: 'Test input' } })

    expect(screen.getByText('10/1000 characters')).toBeInTheDocument()
  })

  it('renders example predictions', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    expect(screen.getByText('Examples:')).toBeInTheDocument()
    expect(screen.getByText(/Bitcoin will reach \$100k/)).toBeInTheDocument()
  })

  it('fills input when clicking example', () => {
    renderWithIntl(<ExpressForecastClient userId="test-user" />)

    const example = screen.getByText(/Bitcoin will reach \$100k/)
    fireEvent.click(example)

    const input = screen.getByPlaceholderText(/Describe your event OR paste/) as HTMLTextAreaElement
    expect(input.value).toContain('Bitcoin')
  })

  // ── Progress stages ────────────────────────────────────────────
  describe('progress stages', () => {
    it('shows checking step immediately on generate click', async () => {
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(() => {})) // never resolves

      renderWithIntl(<ExpressForecastClient userId="test-user" />)
      const input = screen.getByPlaceholderText(/Describe your event OR paste/)
      fireEvent.change(input, { target: { value: 'Bitcoin will hit 100k' } })

      await act(async () => {
        fireEvent.click(screen.getByText('Generate Forecast'))
      })

      expect(screen.getByText('Checking content')).toBeInTheDocument()
    })

    it('transitions to searching step on searching SSE event', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            JSON.stringify({ stage: 'searching', data: { message: 'Looking for articles…' } }) + '\n'
          ))
          // leave open so the component stays in that state
        },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stream, { status: 200 }))

      renderWithIntl(<ExpressForecastClient userId="test-user" />)
      fireEvent.change(screen.getByPlaceholderText(/Describe your event OR paste/), { target: { value: 'Bitcoin will hit 100k' } })

      await act(async () => {
        fireEvent.click(screen.getByText('Generate Forecast'))
      })

      await screen.findByText('Searching for articles')
      expect(screen.getByText(/Looking for articles/)).toBeInTheDocument()
    })

    it('shows AI analysis step and sub-message on analyzing SSE event', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            JSON.stringify({ stage: 'analyzing', data: { message: 'AI is reading 3 articles…' } }) + '\n'
          ))
        },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stream, { status: 200 }))

      renderWithIntl(<ExpressForecastClient userId="test-user" />)
      fireEvent.change(screen.getByPlaceholderText(/Describe your event OR paste/), { target: { value: 'Bitcoin will hit 100k' } })

      await act(async () => {
        fireEvent.click(screen.getByText('Generate Forecast'))
      })

      await screen.findByText('AI analysis')
      expect(screen.getByText(/AI is reading 3 articles/)).toBeInTheDocument()
    })

    it('shows forecast preview when prediction_formed event arrives', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            JSON.stringify({
              stage: 'prediction_formed',
              data: {
                message: 'Forecast drafted',
                preview: { claim: 'Bitcoin will hit $100k', resolveBy: '2026-12-31T23:59:59Z', outcomeType: 'BINARY', options: [] },
              },
            }) + '\n'
          ))
        },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stream, { status: 200 }))

      renderWithIntl(<ExpressForecastClient userId="test-user" />)
      fireEvent.change(screen.getByPlaceholderText(/Describe your event OR paste/), { target: { value: 'Bitcoin will hit 100k' } })

      await act(async () => {
        fireEvent.click(screen.getByText('Generate Forecast'))
      })

      await screen.findByText('Bitcoin will hit $100k')
    })
  })

  // ── Confirm & Publish flow (direct API integration) ───────────
  describe('handleCreatePrediction (Confirm & Publish)', () => {
    const generatedData: GeneratedPrediction = {
      claimText: 'Bitcoin will reach $100k',
      resolveByDatetime: '2026-12-31T23:59:59Z',
      detailsText: 'Context about Bitcoin',
      tags: ['Crypto', 'Finance'],
      resolutionRules: 'Resolved by CoinMarketCap',
      outcomeType: 'BINARY',
      options: [],
      probabilitySuggestion: 60,
      probabilityReasoning: 'Momentum is strong',
      newsAnchor: {
        url: 'https://example.com',
        title: 'Bitcoin News',
        snippet: 'Bitcoin is booming',
      },
      additionalLinks: [],
    }

    const renderInReviewState = async (data = generatedData) => {
      // 1. Mock the generation stream
      const streamBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ stage: 'complete', data }) + '\n')
          )
          controller.close()
        },
      })

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(streamBody, { status: 200 })
      )

      renderWithIntl(<ExpressForecastClient userId="test-user" />)

      const input = screen.getByPlaceholderText(/Describe your event OR paste/)
      fireEvent.change(input, { target: { value: 'Bitcoin will reach $100k this year' } })
      
      await act(async () => {
        fireEvent.click(screen.getByText('Generate Forecast'))
      })

      return await screen.findByText('Confirm & Publish', {}, { timeout: 3000 })
    }

    it('directly creates and publishes the prediction and redirects to the new page', async () => {
      const confirmButton = await renderInReviewState()

      // 2. Mock the creation API
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'new-id' }), { status: 201 })
      )
      // 3. Mock the publishing API
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'new-id', status: 'ACTIVE' }), { status: 200 })
      )

      await act(async () => {
        fireEvent.click(confirmButton)
      })

      // Verify immediate feedback (button is disabled while loading)
      expect(confirmButton).toBeDisabled()
      expect(screen.getByText('Confirm & Publish')).toBeInTheDocument()

      // Wait for redirect
      await vi.waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/forecasts/new-id?newly_created=true')
      })
    })

    it('renders Review Forecast heading after successful generation', async () => {
      await renderInReviewState()
      expect(screen.getByText('Review Forecast')).toBeInTheDocument()
      expect(screen.getByText(generatedData.claimText)).toBeInTheDocument()
    })

    it('shows Binary outcome type badge for binary predictions', async () => {
      await renderInReviewState()
      expect(screen.getByText(/Binary/)).toBeInTheDocument()
    })

    it('shows Multiple Choice badge and options for multiple choice predictions', async () => {
      const mcData: GeneratedPrediction = {
        ...generatedData,
        claimText: 'Who will win the 2028 US presidential election?',
        outcomeType: 'MULTIPLE_CHOICE',
        options: ['Candidate A', 'Candidate B', 'Candidate C', 'Other'],
      }

      await renderInReviewState(mcData)
      expect(screen.getByText('Multiple Choice')).toBeInTheDocument()
      expect(screen.getByText('Candidate A')).toBeInTheDocument()
    })

    it('sends isPublic: true by default when publishing', async () => {
      await renderInReviewState()

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-id' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-id', status: 'ACTIVE' }), { status: 200 }))

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm & Publish'))
      })

      await vi.waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalled()
      })

      // calls[0] = generate stream, calls[1] = create, calls[2] = publish
      const createCall = vi.mocked(globalThis.fetch).mock.calls[1]
      const body = JSON.parse(createCall[1]?.body as string)
      expect(body.isPublic).toBe(true)
    })

    it('shows Public visibility toggle by default on review step', async () => {
      await renderInReviewState()
      expect(screen.getByText(/Public — visible in the feed/)).toBeInTheDocument()
    })

    it('toggles to Unlisted when visibility button is clicked', async () => {
      await renderInReviewState()

      await act(async () => {
        fireEvent.click(screen.getByText(/Public — visible in the feed/))
      })
      expect(screen.getByText(/Unlisted — only people with the link/)).toBeInTheDocument()
    })

    it('sends isPublic: false when set to Unlisted before publishing', async () => {
      await renderInReviewState()

      // Toggle to unlisted
      await act(async () => {
        fireEvent.click(screen.getByText(/Public — visible in the feed/))
      })

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-id' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-id', status: 'ACTIVE' }), { status: 200 }))

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm & Publish'))
      })

      await vi.waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalled()
      })

      // calls[0] = generate stream, calls[1] = create, calls[2] = publish
      const createCall = vi.mocked(globalThis.fetch).mock.calls[1]
      const body = JSON.parse(createCall[1]?.body as string)
      expect(body.isPublic).toBe(false)
    })

    it('shows edit form when Edit button clicked', async () => {
      await renderInReviewState()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      })

      expect(screen.getByText('Save Changes')).toBeInTheDocument()
    })

    it('hides visibility toggle during edit mode', async () => {
      await renderInReviewState()

      const editBtn = screen.getByRole('button', { name: /edit/i })
      await act(async () => {
        fireEvent.click(editBtn)
      })

      expect(screen.queryByText(/Public — visible in the feed/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Unlisted — only people with the link/)).not.toBeInTheDocument()
    })

    it('entering a valid date and 24h time in edit mode updates the field values', async () => {
      await renderInReviewState()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      })

      // DateTimeField splits the value (2026-12-31T23:59:59Z, TZ=UTC in tests)
      // into a DD/MM/YYYY date field and a 24-hour time field.
      const dateInput = screen.getByDisplayValue('31/12/2026') as HTMLInputElement
      const timeInput = screen.getByDisplayValue('23:59') as HTMLInputElement

      await act(async () => {
        fireEvent.change(dateInput, { target: { value: '15/06/2027' } })
        fireEvent.change(timeInput, { target: { value: '12:00' } })
      })

      expect(dateInput.value).toBe('15/06/2027')
      expect(timeInput.value).toBe('12:00')
    })

    it('entering a partial/invalid date does not throw', async () => {
      await renderInReviewState()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      })

      const dateInput = screen.getByDisplayValue('31/12/2026') as HTMLInputElement

      // Incomplete input mid-edit (e.g. just "6") must not produce an Invalid
      // Date; DateTimeField reports it as '' instead.
      expect(() => {
        fireEvent.change(dateInput, { target: { value: '6' } })
      }).not.toThrow()
    })

    it('shows the unverified-date warning when the server flags ungrounded years', async () => {
      await renderInReviewState({
        ...generatedData,
        claimText: 'Knesset elections will be held by December 31, 2027',
        resolveByDatetime: '2027-12-31T23:59:59Z',
        ungroundedYears: ['2027'],
      })

      expect(screen.getByText('Unverified date: 2027')).toBeInTheDocument()
      expect(screen.getByText(/The AI inferred this date/)).toBeInTheDocument()
    })

    it('shows no date warning when ungroundedYears is absent or empty', async () => {
      await renderInReviewState({ ...generatedData, ungroundedYears: [] })

      expect(screen.queryByText(/Unverified date/)).not.toBeInTheDocument()
    })

    it('clears the date warning once the author removes the flagged year from the claim', async () => {
      await renderInReviewState({
        ...generatedData,
        claimText: 'Knesset elections will be held by December 31, 2027',
        ungroundedYears: ['2027'],
      })
      expect(screen.getByText('Unverified date: 2027')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      })
      fireEvent.change(screen.getByLabelText('Claim text'), {
        target: { value: 'Knesset elections will be held by December 31, 2026' },
      })
      await act(async () => {
        fireEvent.click(screen.getByText('Save Changes'))
      })

      expect(screen.queryByText(/Unverified date/)).not.toBeInTheDocument()
    })

    it('keeps the date warning while the flagged year survives the edit', async () => {
      await renderInReviewState({
        ...generatedData,
        claimText: 'Knesset elections will be held by December 31, 2027',
        ungroundedYears: ['2027'],
      })

      // Rewords the claim but leaves the suspect 2027 in place — still unverified.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
      })
      fireEvent.change(screen.getByLabelText('Claim text'), {
        target: { value: 'The next Knesset elections will happen by December 31, 2027' },
      })
      await act(async () => {
        fireEvent.click(screen.getByText('Save Changes'))
      })

      expect(screen.getByText('Unverified date: 2027')).toBeInTheDocument()
    })

    it('reverts button when publish API fails', async () => {
      await renderInReviewState()

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm & Publish'))
      })

      // Button should revert from "Publishing..." back to normal after failure
      await vi.waitFor(() => {
        expect(screen.getByText('Confirm & Publish')).toBeInTheDocument()
      })
      expect(screen.queryByText('Publishing...')).not.toBeInTheDocument()
    })
  })
})
