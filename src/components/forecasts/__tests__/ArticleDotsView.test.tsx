import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import ProbabilityChart, { EXPAND_CLICK_DELAY_MS } from '../ProbabilityChart'
import { dotRadius } from '../ArticleDotsView'
import type { ArticleDot } from '@/lib/article-dots'
import enMessages from '../../../../messages/en.json'
import heMessages from '../../../../messages/he.json'

// The latest props recharts' LineChart was rendered with, so a test can drive the compact
// chart's press/release/double-click handlers the way recharts would.
type ChartHandlers = {
  onMouseDown?: (s: { activeLabel?: number }) => void
  onMouseUp?: () => void
  onDoubleClick?: () => void
}
let lineChartProps: ChartHandlers = {}

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
    LineChart: (props: React.ComponentProps<typeof actual.LineChart>) => {
      lineChartProps = props as unknown as ChartHandlers
      return <actual.LineChart {...props} />
    },
  }
})

const DOTS: ArticleDot[] = [
  {
    url: 'https://news.example/yes-story',
    title: 'Coalition talks advance',
    outlet: 'Example News',
    outletPath: '/sources/Example%20News',
    firstSeenAt: '2026-11-01T06:00:00.000Z',
    probYes: 0.8,
    certainty: 0.9,
    side: 'yes',
  },
  {
    url: 'https://other.example/no-story',
    title: null,
    outlet: null,
    outletPath: null,
    firstSeenAt: '2026-11-02T06:00:00.000Z',
    probYes: 0.25,
    certainty: null,
    side: 'no',
  },
]

const SNAPSHOTS = [
  { createdAt: '2026-11-01T00:00:00.000Z', externalProbability: 40 },
  { createdAt: '2026-11-03T00:00:00.000Z', externalProbability: 55 },
]

function renderChart(props: Partial<React.ComponentProps<typeof ProbabilityChart>> = {}, locale: 'en' | 'he' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'he' ? heMessages : enMessages}>
      <ProbabilityChart
        forecastId="p1"
        commitments={[]}
        snapshots={SNAPSHOTS}
        outcomeType="BINARY"
        options={[]}
        {...props}
      />
    </NextIntlClientProvider>,
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  lineChartProps = {}
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ predictionId: 'p1', dots: DOTS }) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

const expandButton = () => screen.getByRole('button', { name: enMessages.articleDots.expand })

describe('expanded "every article" chart (daatan#2300)', () => {
  it('offers the expanded view only on a binary forecast with an id and an Oracul line', () => {
    const { unmount } = renderChart()
    expect(expandButton()).toBeInTheDocument()
    unmount()

    renderChart({ forecastId: undefined, commitments: [] })
    expect(screen.queryByRole('button', { name: enMessages.articleDots.expand })).toBeNull()
  })

  it('does not offer it on a multiple-choice forecast', () => {
    renderChart({ outcomeType: 'MULTIPLE_CHOICE', options: [{ id: 'o1', text: 'A' }] })
    expect(screen.queryByRole('button', { name: enMessages.articleDots.expand })).toBeNull()
  })

  it('fetches nothing until opened, then opens a modal dialog with the dots and the caption', async () => {
    renderChart()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(expandButton())
    const dialog = screen.getByRole('dialog', { name: enMessages.articleDots.title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(fetchMock).toHaveBeenCalledWith('/api/forecasts/p1/article-dots', expect.anything())
    expect(within(dialog).getByTestId('article-dots-caption')).toHaveTextContent(enMessages.articleDots.caption)

    const yesDot = await within(dialog).findByRole('link', { name: /Coalition talks advance/ })
    expect(yesDot).toHaveAttribute('href', 'https://news.example/yes-story')
    expect(yesDot).toHaveAttribute('target', '_blank')
    expect(yesDot.querySelector('circle')).toHaveAttribute('r', String(dotRadius(0.9)))
    expect(yesDot.querySelector('circle')).toHaveAttribute('fill', '#10B981')

    // A dot without a title or outlet still gets a name: the fallback title and the host.
    const noDot = within(dialog).getByRole('link', { name: /Untitled article — other\.example: Won't happen · 25%/ })
    expect(noDot.querySelector('circle')).toHaveAttribute('r', String(dotRadius(null)))
    expect(within(dialog).getByText('2 articles read by the Oracul')).toBeInTheDocument()
  })

  it('shows the caption while loading and when no article has a stance yet', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ predictionId: 'p1', dots: [] }) })
    renderChart()
    fireEvent.click(expandButton())
    expect(screen.getByTestId('article-dots-caption')).toBeInTheDocument()
    expect(screen.getByText(enMessages.articleDots.loading)).toBeInTheDocument()
    expect(await screen.findByText(enMessages.articleDots.empty)).toBeInTheDocument()
    expect(screen.getByTestId('article-dots-caption')).toBeInTheDocument()
  })

  it('says so when the series fails to load', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    renderChart()
    fireEvent.click(expandButton())
    expect(await screen.findByText(enMessages.articleDots.error)).toBeInTheDocument()
  })

  it('a focused dot shows its headline, outlet link (via sourcePagePath) and vote', async () => {
    renderChart()
    fireEvent.click(expandButton())
    const dot = await screen.findByRole('link', { name: /Coalition talks advance/ })
    fireEvent.focus(dot)
    const tip = screen.getByTestId('article-dot-tooltip')
    expect(within(tip).getByRole('link', { name: 'Coalition talks advance' })).toHaveAttribute('href', 'https://news.example/yes-story')
    expect(within(tip).getByRole('link', { name: 'Example News' })).toHaveAttribute('href', '/sources/Example%20News')
    expect(within(tip).getByText('Will happen · 80%')).toBeInTheDocument()
  })

  it('a tooltip for an outlet with no page shows the outlet as plain text', async () => {
    renderChart()
    fireEvent.click(expandButton())
    fireEvent.focus(await screen.findByRole('link', { name: /Untitled article/ }))
    const tip = screen.getByTestId('article-dot-tooltip')
    expect(within(tip).getByText('other.example').closest('a')).toBeNull()
  })

  it('Escape closes the sheet and returns focus to the button; the close button closes it too', async () => {
    renderChart()
    fireEvent.click(expandButton())
    const close = screen.getByRole('button', { name: enMessages.articleDots.close })
    expect(close).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(expandButton()).toHaveFocus()
    expect(document.body.style.overflow).toBe('')

    fireEvent.click(expandButton())
    fireEvent.click(screen.getByRole('button', { name: enMessages.articleDots.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('a plain click on the compact chart opens the view; a double-click resets zoom instead', () => {
    vi.useFakeTimers()
    renderChart()
    const ts = new Date(SNAPSHOTS[0].createdAt).getTime()

    // Click: press and release on one point → opens after the double-click window.
    act(() => lineChartProps.onMouseDown?.({ activeLabel: ts }))
    act(() => lineChartProps.onMouseUp?.())
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => vi.advanceTimersByTime(EXPAND_CLICK_DELAY_MS))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    // Double-click: the pending open is cancelled.
    act(() => lineChartProps.onMouseDown?.({ activeLabel: ts }))
    act(() => lineChartProps.onMouseUp?.())
    act(() => lineChartProps.onDoubleClick?.())
    act(() => vi.advanceTimersByTime(EXPAND_CLICK_DELAY_MS * 2))
    expect(screen.queryByRole('dialog')).toBeNull()

    // A release with no press on the plot (e.g. on the brush) is not a click.
    act(() => lineChartProps.onMouseUp?.())
    act(() => vi.advanceTimersByTime(EXPAND_CLICK_DELAY_MS * 2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders under RTL (he) with the chart itself kept left-to-right', async () => {
    renderChart({}, 'he')
    fireEvent.click(screen.getByRole('button', { name: heMessages.articleDots.expand }))
    const dialog = screen.getByRole('dialog', { name: heMessages.articleDots.title })
    expect(within(dialog).getByTestId('article-dots-caption')).toHaveTextContent(heMessages.articleDots.caption)
    await within(dialog).findByRole('link', { name: /Coalition talks advance/ })
    expect(within(dialog).getByRole('img', { name: heMessages.articleDots.chartLabel })).toHaveStyle({ direction: 'ltr' })
  })
})
