import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ResolutionForm } from '../ResolutionForm'

const mockFetch = vi.fn()

describe('ResolutionForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
    localStorage.clear()
  })

  it('renders outcome options and submit button', () => {
    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    expect(screen.getByText('Correct')).toBeInTheDocument()
    expect(screen.getByText('Wrong')).toBeInTheDocument()
    expect(screen.getByText('Void')).toBeInTheDocument()
    expect(screen.getByText('Unresolvable')).toBeInTheDocument()
    const submitButtons = screen.getAllByRole('button', { name: /Confirm Resolution/i })
    expect(submitButtons.length).toBeGreaterThan(0)
  })

  it('calls resolve API on submit with correct outcome', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} onResolved={vi.fn()} />)

    fireEvent.click(screen.getByText('Correct'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/forecasts/pred-1/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'correct',
          evidenceLinks: undefined,
          resolutionNote: undefined,
        }),
      })
    })
  })

  it('disables submit until an outcome is selected', async () => {
    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    expect(submitButton).toBeDisabled()

    fireEvent.click(submitButton)
    expect(mockFetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Correct'))
    expect(submitButton).not.toBeDisabled()
  })

  it('calls onResolved callback when resolution succeeds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const onResolved = vi.fn()

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} onResolved={onResolved} />)

    fireEvent.click(screen.getByText('Correct'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled()
    })
  })

  it('sends selected outcome when different option chosen', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('Wrong'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.outcome).toBe('wrong')
    })
  })

  it('displays error when API returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Prediction not found' }),
    })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('Correct'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Prediction not found')).toBeInTheDocument()
    })
  })

  it('includes evidence links when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('Correct'))
    const evidenceTextarea = document.getElementById('evidence') as HTMLTextAreaElement
    fireEvent.change(evidenceTextarea, {
      target: { value: 'https://example.com/1\nhttps://example.com/2' },
    })
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.evidenceLinks).toEqual(['https://example.com/1', 'https://example.com/2'])
    })
  })

  it('shows "Searching articles..." during AI research', async () => {
    let resolveResearch!: (value: unknown) => void
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => { resolveResearch = resolve })
    )

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('AI Assist'))

    await waitFor(() => {
      expect(screen.getByText('Searching articles...')).toBeInTheDocument()
    })

    await act(async () => {
      resolveResearch({
        ok: true,
        json: async () => ({
          outcome: 'correct',
          reasoning: 'test',
          evidenceLinks: [],
          timings: { searchMs: 5000, llmMs: 8000, totalMs: 13000 },
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument()
    })
  })

  it('shows "Scoring commitments..." during resolution submit', async () => {
    let resolveSubmit!: (value: unknown) => void
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => { resolveSubmit = resolve })
    )

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('Correct'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Scoring commitments...')).toBeInTheDocument()
    })

    await act(async () => {
      resolveSubmit({ ok: true, json: async () => ({}) })
    })
  })

  it('saves research timings to localStorage after successful AI research', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        outcome: 'correct',
        reasoning: 'test',
        evidenceLinks: [],
        timings: { searchMs: 6000, llmMs: 9000, totalMs: 15000 },
      }),
    })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('AI Assist'))

    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument()
    })

    const stored = JSON.parse(localStorage.getItem('daatan:research-timings') ?? 'null')
    expect(stored?.searchMs).toBe(6000)
    expect(stored?.llmMs).toBe(9000)
  })

  it('saves resolve-step timings to localStorage after a successful resolution (daatan#1139)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'pred-1', timings: { scoringMs: 1500, updatingMs: 600 } }),
    })

    render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)

    fireEvent.click(screen.getByText('Correct'))
    const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/resolved as: correct/i)).toBeInTheDocument()
    })

    // recordDuration is an EWMA (60% prior default, 40% latest sample), not a
    // raw overwrite — first-ever call blends the measured value into the
    // built-in default (1200/800ms): round(1200*.6 + 1500*.4) = 1320, round(800*.6 + 600*.4) = 720.
    expect(Number(localStorage.getItem('daatan:timing:resolve-scoring'))).toBe(1320)
    expect(Number(localStorage.getItem('daatan:timing:resolve-updating'))).toBe(720)
  })

  // daatan#1479
  describe('stale AI note on a human-flipped outcome', () => {
    const runAiResearch = async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outcome: 'wrong',
          reasoning: 'The claim cannot be resolved from available evidence.',
          evidenceLinks: [],
        }),
      })
      fireEvent.click(screen.getByText('AI Assist'))
      await waitFor(() => {
        expect(screen.getByText('AI Assist')).toBeInTheDocument()
      })
    }

    it('clears the untouched AI note when the human flips the outcome', async () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)
      await runAiResearch()

      const noteTextarea = document.getElementById('note') as HTMLTextAreaElement
      expect(noteTextarea.value).toBe('The claim cannot be resolved from available evidence.')

      fireEvent.click(screen.getByText('Correct'))
      expect(noteTextarea.value).toBe('')
    })

    it('keeps the AI note when the human re-selects the AI-suggested outcome', async () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)
      await runAiResearch()

      fireEvent.click(screen.getByText('Wrong'))
      const noteTextarea = document.getElementById('note') as HTMLTextAreaElement
      expect(noteTextarea.value).toBe('The claim cannot be resolved from available evidence.')
    })

    it('keeps a human-edited note when the outcome is flipped', async () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)
      await runAiResearch()

      const noteTextarea = document.getElementById('note') as HTMLTextAreaElement
      fireEvent.change(noteTextarea, { target: { value: 'My own reasoning.' } })

      fireEvent.click(screen.getByText('Correct'))
      expect(noteTextarea.value).toBe('My own reasoning.')
    })

    it('does not submit the stale AI note after a flip', async () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} />)
      await runAiResearch()

      fireEvent.click(screen.getByText('Correct'))
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2)
        const callBody = JSON.parse(mockFetch.mock.calls[1][1].body)
        expect(callBody.outcome).toBe('correct')
        expect(callBody.resolutionNote).toBeUndefined()
      })
    })
  })

  // daatan#1234 check #2
  describe('pin-acknowledgment gate', () => {
    it('does not show the banner when the outcome agrees with the pin', () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} settled confidence={3} />)

      fireEvent.click(screen.getByText('Wrong'))
      expect(screen.queryByText(/reviewed the disagreement/i)).not.toBeInTheDocument()
    })

    it('shows the banner and disables submit until acknowledged when settled contradicts the outcome', () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} settled confidence={3} />)

      fireEvent.click(screen.getByText('Correct'))
      expect(screen.getByText(/settled this forecast as an accomplished fact/i)).toBeInTheDocument()
      const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
      expect(submitButton).toBeDisabled()

      fireEvent.click(screen.getByRole('checkbox'))
      expect(submitButton).not.toBeDisabled()
    })

    it('shows the extreme-confidence wording (not the settled wording) when unsettled but extreme', () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} confidence={95} />)

      fireEvent.click(screen.getByText('Wrong'))
      expect(screen.getByText(/current confidence is extreme/i)).toBeInTheDocument()
    })

    it('resets acknowledgment when the outcome selection changes', () => {
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} settled confidence={3} />)

      fireEvent.click(screen.getByText('Correct'))
      fireEvent.click(screen.getByRole('checkbox'))
      const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
      expect(submitButton).not.toBeDisabled()

      fireEvent.click(screen.getByText('Wrong'))
      fireEvent.click(screen.getByText('Correct'))
      expect(submitButton).toBeDisabled()
    })

    it('sends resolutionOverrodePin: true once acknowledged', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      render(<ResolutionForm predictionId="pred-1" outcomeType="BINARY" options={[]} settled confidence={3} />)

      fireEvent.click(screen.getByText('Correct'))
      fireEvent.click(screen.getByRole('checkbox'))
      const submitButton = screen.getAllByRole('button', { name: /Confirm Resolution/i })[0]
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
        expect(callBody.resolutionOverrodePin).toBe(true)
      })
    })

    it('does not gate MULTIPLE_CHOICE resolutions even with settled + extreme confidence', () => {
      render(
        <ResolutionForm
          predictionId="pred-1"
          outcomeType="MULTIPLE_CHOICE"
          options={[{ id: 'o1', text: 'Option A' }]}
          settled
          confidence={3}
        />,
      )

      fireEvent.click(screen.getByText('Correct'))
      expect(screen.queryByText(/reviewed the disagreement/i)).not.toBeInTheDocument()
    })
  })
})
