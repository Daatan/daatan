import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { listForesawEvents, getForesawEvent, getForesawSourceBoard, selfHosted, notFound } = vi.hoisted(() => ({
  listForesawEvents: vi.fn(),
  getForesawEvent: vi.fn(),
  getForesawSourceBoard: vi.fn(),
  selfHosted: { value: false },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/lib/services/retro-foresaw', () => ({ listForesawEvents, getForesawEvent, getForesawSourceBoard, BOARD_MIN_EVENTS: 2 }))
vi.mock('@/lib/edition', () => ({ isSelfHosted: () => selfHosted.value }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('next/server', () => ({ connection: async () => undefined }))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

import HubPage, { generateMetadata as hubMetadata } from '../page'
import EventPage, { generateMetadata as eventMetadata } from '../[slug]/page'
import SourcesPage, { generateMetadata as sourcesMetadata } from '../sources/page'

const summary = {
  slug: 'carrier', eventText: 'A third US carrier arrived', eventDate: '2026-11-16', asOf: '2026-11-09',
  outcome: 'correct', oraculProbability: 0.81, called: 8, against: 0, total: 9,
}
const event = {
  ...summary,
  claimText: 'A third US aircraft carrier will arrive by Nov 30',
  eventUrl: 'https://e.com/report',
  hasWeights: false,
  reports: [{ url: 'https://r.com/1', outlet: 'r.com', publishedDate: '2026-11-16' }],
  articles: [
    { url: 'https://a.com/1', title: 'Carrier heads east', outlet: 'a.com', publishedDate: '2026-11-08', stance: 0.7, side: 'called', weightShare: null },
    { url: 'https://b.com/2', title: 'No carrier soon', outlet: 'b.com', publishedDate: '2026-11-01', stance: -0.4, side: 'against', weightShare: null },
  ],
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

beforeEach(() => {
  vi.clearAllMocks()
  selfHosted.value = false
})

describe('/who-foresaw hub', () => {
  it('server-renders a link to every event page', async () => {
    listForesawEvents.mockResolvedValue([summary])
    render(await HubPage())
    expect(screen.getByRole('link', { name: /A third US carrier arrived/ })).toHaveAttribute('href', '/who-foresaw/carrier')
    expect(screen.getByRole('link', { name: 'board.link' })).toHaveAttribute('href', '/who-foresaw/sources')
  })

  it('has no source-board link while it has no events', async () => {
    listForesawEvents.mockResolvedValue([])
    render(await HubPage())
    expect(screen.queryByRole('link', { name: 'board.link' })).toBeNull()
  })

  it('is indexed and self-canonical when it has events, noindex when empty', async () => {
    listForesawEvents.mockResolvedValue([summary])
    const full = await hubMetadata()
    expect(full.robots).toBeUndefined()
    expect(full.alternates?.canonical).toBe('/who-foresaw')
    listForesawEvents.mockResolvedValue([])
    expect((await hubMetadata()).robots).toEqual({ index: false, follow: true })
  })

  it('shows the empty state when the lookup fails', async () => {
    listForesawEvents.mockRejectedValue(new Error('db down'))
    render(await HubPage())
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('404s on a self-hosted install', async () => {
    selfHosted.value = true
    await expect(HubPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('/who-foresaw/[slug]', () => {
  it('is noindex, follow', async () => {
    getForesawEvent.mockResolvedValue(event)
    const meta = await eventMetadata(params('carrier'))
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(meta.alternates?.canonical).toBe('/who-foresaw/carrier')
  })

  it('splits articles into called / against and lists the confirming reports separately', async () => {
    getForesawEvent.mockResolvedValue(event)
    render(await EventPage(params('carrier')))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A third US carrier arrived')
    expect(screen.getByRole('heading', { name: /sections\.called/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sections\.against/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /sections\.neutral/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Carrier heads east' })).toHaveAttribute('href', 'https://a.com/1')
    expect(screen.getByRole('link', { name: 'r.com' })).toHaveAttribute('href', 'https://r.com/1')
    expect(screen.getByText('recencyNote')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /forecasts/ })).toBeNull()
  })

  it('404s for an unknown or unapproved slug', async () => {
    getForesawEvent.mockResolvedValue(null)
    await expect(EventPage(params('pending-draft'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await eventMetadata(params('pending-draft'))).robots).toEqual({ index: false, follow: false })
  })
})

describe('/who-foresaw/sources', () => {
  const board = {
    eventCount: 6,
    hiddenOutlets: 6,
    rows: [{
      outlet: 'jpost.com', called: 2, against: 1, total: 6,
      events: [
        { slug: 'carrier', eventText: 'A third US carrier arrived', side: 'called' },
        { slug: 'bab', eventText: 'Houthis took Bab el-Mandeb', side: 'against' },
      ],
    }],
  }

  it('is noindex, follow and self-canonical', async () => {
    const meta = await sourcesMetadata()
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(meta.alternates?.canonical).toBe('/who-foresaw/sources')
  })

  it('shows each outlet with its counts and links to its events, and counts the outlets below the floor', async () => {
    getForesawSourceBoard.mockResolvedValue(board)
    render(await SourcesPage())
    expect(screen.getByRole('link', { name: 'jpost.com' })).toHaveAttribute('href', '/sources/jpost.com')
    expect(screen.getByText(`board.counts:${JSON.stringify({ called: 2, against: 1, total: 6, share: 33 })}`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Houthis took Bab el-Mandeb' })).toHaveAttribute('href', '/who-foresaw/bab')
    expect(screen.getByText(`board.hidden:${JSON.stringify({ count: 6, min: 2 })}`)).toBeInTheDocument()
    expect(screen.getByText(`board.caveat:${JSON.stringify({ events: 6 })}`)).toBeInTheDocument()
  })

  it('shows the empty state when the lookup fails', async () => {
    getForesawSourceBoard.mockRejectedValue(new Error('db down'))
    render(await SourcesPage())
    expect(screen.getByText('board.empty')).toBeInTheDocument()
    expect(screen.queryByText(/^board\.caveat/)).toBeNull()
  })

  it('404s on a self-hosted install', async () => {
    selfHosted.value = true
    await expect(SourcesPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
