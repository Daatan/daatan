import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { axe } from 'jest-axe'
import { NextIntlClientProvider } from 'next-intl'
import ContextTimeline, { groupSources } from '../ContextTimeline'
import enMessages from '../../../../messages/en.json'

const mockFetch = vi.fn()

const renderWithIntl = (ui: React.ReactElement) => {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

// Long enough to exceed both the mobile (180) and desktop (420) preview caps,
// built from short, distinct sentences so truncation boundaries are easy to assert on.
const LONG_CONTEXT = Array.from(
  { length: 12 },
  (_, i) => `This is sentence number ${i + 1} of the ongoing situation update.`
).join(' ')

describe('ContextTimeline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
    // Default: GET returns empty timeline
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ currentContext: null, contextUpdatedAt: null, snapshots: [] }),
    })
  })

  it('renders section header', async () => {
    await act(async () => {
      renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={true} />)
    })
    expect(screen.getByText(enMessages.context.title)).toBeInTheDocument()
  })

  it('shows the update-context button when canAnalyze is true', async () => {
    await act(async () => {
      renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={true} />)
    })
    expect(screen.getByText(enMessages.context.analyze)).toBeInTheDocument()
  })

  it('hides the update-context button when canAnalyze is false', async () => {
    await act(async () => {
      renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)
    })
    expect(screen.queryByText(enMessages.context.analyze)).not.toBeInTheDocument()
  })

  it('has no automatically detectable a11y violations, with the update-context button visible', async () => {
    let container: HTMLElement
    await act(async () => {
      ;({ container } = renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={true} />))
    })
    expect(await axe(container!)).toHaveNoViolations()
  })

  it('shows short context directly under the heading, with no "See more" needed', async () => {
    await act(async () => {
      renderWithIntl(
        <ContextTimeline predictionId="p1" initialContext="Current situation summary" initialSnapshots={[]} canAnalyze={false} />
      )
    })
    expect(screen.getByText('Current situation summary')).toBeInTheDocument()
    expect(screen.queryByText(enMessages.context.seeMore)).not.toBeInTheDocument()
  })

  it('fetches timeline on mount and displays the fetched context without needing a click', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Fetched context',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [{ id: 's1', summary: 'Fetched context', sources: [], createdAt: '2026-02-20T10:00:00Z' }],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/forecasts/p1/context')
    })

    await waitFor(() => {
      expect(screen.getByText('Fetched context')).toBeInTheDocument()
    })
  })

  it('shows a truncated preview with "See more" when context is long, and never cuts mid-sentence', async () => {
    await act(async () => {
      renderWithIntl(
        <ContextTimeline predictionId="p1" initialContext={LONG_CONTEXT} initialSnapshots={[]} canAnalyze={false} />
      )
    })

    const seeMoreButtons = screen.getAllByText(enMessages.context.seeMore)
    expect(seeMoreButtons.length).toBeGreaterThan(0)

    // The full text is present in the DOM (crawlable) even while visually collapsed.
    const full = screen.getByText(LONG_CONTEXT)
    expect(full).toBeInTheDocument()
    expect(full.className).toMatch(/hidden/)

    // Sentence boundary preserved: the preview (ellipsis-suffixed, shorter than
    // the full text) always ends its kept sentence with a period, never a
    // mid-word/mid-sentence cut.
    const previews = screen.getAllByText((content, el) => {
      if (el?.tagName !== 'P') return false
      const text = el.textContent ?? ''
      return text.endsWith('…') && text.length < LONG_CONTEXT.length
    })
    expect(previews.length).toBeGreaterThan(0)
    for (const p of previews) {
      expect(p.textContent!.slice(0, -1).trim().endsWith('.')).toBe(true)
    }
  })

  it('expands to show the full text and "See less" when "See more" is clicked', async () => {
    await act(async () => {
      renderWithIntl(
        <ContextTimeline predictionId="p1" initialContext={LONG_CONTEXT} initialSnapshots={[]} canAnalyze={false} />
      )
    })

    fireEvent.click(screen.getAllByText(enMessages.context.seeMore)[0])

    expect(screen.getAllByText(enMessages.context.seeLess).length).toBeGreaterThan(0)
    const full = screen.getByText(LONG_CONTEXT)
    expect(full.className).not.toMatch(/hidden/)
  })

  it('reveals "Based on" source attribution once expanded, and keeps it in the DOM while collapsed', async () => {
    await act(async () => {
      renderWithIntl(
        <ContextTimeline
          predictionId="p1"
          initialContext={LONG_CONTEXT}
          initialSnapshots={[]}
          canAnalyze={false}
          newsAnchor={{ title: 'Original article', url: 'https://example.com/a', source: 'Example News' }}
        />
      )
    })

    // Present in the DOM (crawlable) even before expanding.
    const basedOnLink = screen.getByText('Example News')
    expect(basedOnLink).toBeInTheDocument()

    fireEvent.click(screen.getAllByText(enMessages.context.seeMore)[0])
    // Still there, now visible (the wrapping "hidden" class list is gone at least once).
    expect(screen.getByText('Example News')).toBeInTheDocument()
  })

  it('shows previous updates toggle for short (non-collapsing) context', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Latest',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [
          { id: 's2', summary: 'Latest', sources: [], createdAt: '2026-02-20T10:00:00Z' },
          { id: 's1', summary: 'Older update', sources: [], createdAt: '2026-02-19T10:00:00Z' },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => {
      expect(screen.getByText('1 previous update')).toBeInTheDocument()
    })
  })

  it('expands timeline when toggle is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Latest',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [
          { id: 's2', summary: 'Latest', sources: [], createdAt: '2026-02-20T10:00:00Z' },
          { id: 's1', summary: 'Older update', sources: [], createdAt: '2026-02-19T10:00:00Z' },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => {
      expect(screen.getByText('1 previous update')).toBeInTheDocument()
    })

    // Older update should not be visible yet
    expect(screen.queryByText('Older update')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('1 previous update'))

    expect(screen.getByText('Older update')).toBeInTheDocument()
  })

  it('calls POST and updates state when update-context is clicked', async () => {
    // First call: GET on mount
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ currentContext: null, contextUpdatedAt: null, snapshots: [] }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={true} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/forecasts/p1/context')
    })

    // Second call: POST on update — returns SSE stream
    const sseData = [
      `data: ${JSON.stringify({ type: 'summary', newContext: 'Freshly analyzed context', contextUpdatedAt: '2026-02-20T12:00:00Z' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done', success: true, timeline: [{ id: 's1', summary: 'Freshly analyzed context', sources: [], createdAt: '2026-02-20T12:00:00Z' }], timings: { searchMs: 1000, llmMs: 2000, oracleMs: 3000, totalMs: 6000 } })}\n\n`,
    ].join('')
    const sseEncoder = new TextEncoder()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(sseData))
          controller.close()
        },
      }),
    })

    fireEvent.click(screen.getByText(enMessages.context.analyze))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/forecasts/p1/context', { method: 'POST' })
    })

    await waitFor(() => {
      expect(screen.getByText('Freshly analyzed context')).toBeInTheDocument()
    })
  })


  it('renders Oracle CI text without a per-source list when oracleSnapshot is present', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Oracle-backed context',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [
          {
            id: 's1',
            summary: 'Oracle-backed context',
            sources: [],
            createdAt: '2026-02-20T10:00:00Z',
            externalProbability: 64,
            externalReasoning: 'TruthMachine Oracle (calibrated multi-source estimate)',
            oracleSnapshot: {
              mean: 0.28,
              std: 0.12,
              ciLow: 52,
              ciHigh: 76,
              articlesUsed: 3,
              sources: [
                {
                  sourceId: 'reuters',
                  sourceName: 'Reuters',
                  url: 'https://reuters.com/x',
                  stance: 0.7,
                  certainty: 0.85,
                  credibilityWeight: 0.95,
                  claims: ['Claim A'],
                },
                {
                  sourceId: 'blog',
                  sourceName: 'Random Blog',
                  url: 'https://blog.example.com/x',
                  stance: -0.4,
                  certainty: 0.3,
                  credibilityWeight: 0.25,
                  claims: ['Claim B'],
                },
              ],
            },
          },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    // Spread shown as ±halfWidth (ciHigh=76, ciLow=52 → (76-52)/2 = 12)
    await waitFor(() => {
      expect(screen.getByText(/± 12%/)).toBeInTheDocument()
    })

    // Articles-used suffix appended to reasoning
    expect(screen.getByText(/3 articles/)).toBeInTheDocument()

    // The per-source chip list moved out of the timeline — the voters panel
    // ("Sources behind the AI estimate") is the only place sources render now.
    expect(screen.queryByTestId('oracle-sources')).toBeNull()
    expect(screen.queryByText('Reuters')).toBeNull()
    expect(screen.queryByText('Random Blog')).toBeNull()

    // Not a settlement pin — no settled badge or note (#1250).
    expect(screen.queryByText(enMessages.context.settledBadge)).toBeNull()
    expect(screen.queryByTestId('settled-pin-note')).toBeNull()
  })

  it('shows the settlement-pin badge and names only the settling sources when the snapshot is settled (#1250)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Pinned context',
        contextUpdatedAt: '2026-08-01T10:00:00Z',
        snapshots: [
          {
            id: 's1',
            summary: 'Pinned context',
            sources: [],
            createdAt: '2026-08-01T10:00:00Z',
            externalProbability: 97,
            externalReasoning: 'TruthMachine Oracle (calibrated multi-source estimate)',
            oracleSnapshot: {
              mean: 97,
              std: 3,
              ciLow: 91,
              ciHigh: 100,
              articlesUsed: 12,
              settled: true,
              sources: [
                { sourceId: 'a', sourceName: 'RFE/RL', url: 'https://rferl.org/x', stance: 0.9, certainty: 0.9, credibilityWeight: 1, claims: [], settled: true },
                { sourceId: 'b', sourceName: 'Reuters', url: 'https://reuters.com/z', stance: 0.1, certainty: 0.5, credibilityWeight: 1, claims: [], settled: false },
              ],
            },
          },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    await waitFor(() => {
      expect(screen.getByText(enMessages.context.settledBadge)).toBeInTheDocument()
    })
    const note = screen.getByTestId('settled-pin-note')
    expect(note).toHaveTextContent(enMessages.context.settledNote)
    expect(note).toHaveTextContent('RFE/RL')
    expect(note).not.toHaveTextContent('Reuters')
  })

  it('omits the Oracle sources sub-section when oracleSnapshot is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'LLM-fallback context',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [
          {
            id: 's1',
            summary: 'LLM-fallback context',
            sources: [],
            createdAt: '2026-02-20T10:00:00Z',
            externalProbability: 55,
            externalReasoning: 'Based on articles',
            oracleSnapshot: null,
          },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    await waitFor(() => {
      expect(screen.getByText('55%')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('oracle-sources')).toBeNull()
    expect(screen.queryByText(/±/)).toBeNull()
  })

  it('pluralizes previous updates correctly', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        currentContext: 'Latest',
        contextUpdatedAt: '2026-02-20T10:00:00Z',
        snapshots: [
          { id: 's3', summary: 'Latest', sources: [], createdAt: '2026-02-20T10:00:00Z' },
          { id: 's2', summary: 'Middle', sources: [], createdAt: '2026-02-19T10:00:00Z' },
          { id: 's1', summary: 'Oldest', sources: [], createdAt: '2026-02-18T10:00:00Z' },
        ],
      }),
    })

    renderWithIntl(<ContextTimeline predictionId="p1" canAnalyze={false} />)

    await waitFor(() => {
      expect(screen.getByText('2 previous updates')).toBeInTheDocument()
    })
  })
})

describe('groupSources', () => {
  it('collapses many articles from the same domain into one entry with a count', () => {
    const grouped = groupSources([
      { title: 'a', url: 'https://aljazeera.com/1', source: 'aljazeera.com' },
      { title: 'b', url: 'https://aljazeera.com/2', source: 'aljazeera.com' },
      { title: 'c', url: 'https://middleeasteye.net/1', source: 'middleeasteye.net' },
    ])
    expect(grouped).toEqual([
      { source: 'aljazeera.com', url: 'https://aljazeera.com/1', count: 2 },
      { source: 'middleeasteye.net', url: 'https://middleeasteye.net/1', count: 1 },
    ])
  })

  it('dedupes identical article URLs so a source is never double-counted', () => {
    const grouped = groupSources([
      { title: 'a', url: 'https://aljazeera.com/1', source: 'aljazeera.com' },
      { title: 'a-dup', url: 'https://aljazeera.com/1', source: 'aljazeera.com' },
    ])
    expect(grouped).toEqual([{ source: 'aljazeera.com', url: 'https://aljazeera.com/1', count: 1 }])
  })

  it('falls back to the URL host when source is missing', () => {
    const grouped = groupSources([{ title: 'x', url: 'https://www.reuters.com/world/x' }])
    expect(grouped).toEqual([{ source: 'reuters.com', url: 'https://www.reuters.com/world/x', count: 1 }])
  })

  it('ignores entries without a URL', () => {
    expect(groupSources([{ title: 'x', url: '' }])).toEqual([])
  })
})
