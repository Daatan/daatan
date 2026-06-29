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
    mockFetch.mockResolvedValueOnce({ ok: true })

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
    mockFetch.mockResolvedValueOnce({ ok: true })
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
    mockFetch.mockResolvedValueOnce({ ok: true })

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
    mockFetch.mockResolvedValueOnce({ ok: true })

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
})
