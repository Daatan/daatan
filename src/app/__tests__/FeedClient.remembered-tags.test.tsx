import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useSession } from 'next-auth/react'
import messages from '../../../messages/en.json'

// daatan#2203: the home feed remembers the tag filter — localStorage for guests, the
// account for signed-in users — and applies it only when the URL names no tags.

let urlTags: string | null = null
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'tags' ? urlTags : null) }),
}))
vi.mock('@/components/forecasts/ForecastCard', () => ({ default: () => <div data-testid="prediction-card" /> }))

import FeedClient from '../FeedClient'

const mockFetch = vi.fn()
global.fetch = mockFetch

const renderFeed = () =>
  render(<NextIntlClientProvider locale="en" messages={messages}><FeedClient /></NextIntlClientProvider>)

const feedCalls = () => mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/forecasts'))
const prefPatches = () =>
  mockFetch.mock.calls.filter((c) => String(c[0]) === '/api/user/preferences' && c[1]?.method === 'PATCH')

function respond(prefs: { feedTags: string[] } = { feedTags: [] }) {
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/user/preferences') ? prefs : { predictions: [] }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  localStorage.clear()
  urlTags = null
  vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as never)
  respond()
})

describe('FeedClient remembered tags (daatan#2203)', () => {
  it('guest: applies tags remembered in localStorage when the URL has none', async () => {
    localStorage.setItem('daatan_feed_tags', JSON.stringify(['AI', 'NotARealTag']))
    renderFeed()
    await waitFor(() => expect(feedCalls().some((u) => u.includes('tags=AI'))).toBe(true))
    expect(feedCalls().some((u) => u.includes('NotARealTag'))).toBe(false)
  })

  it('URL tags win over remembered ones and are not persisted', async () => {
    urlTags = 'Economy'
    localStorage.setItem('daatan_feed_tags', JSON.stringify(['AI']))
    renderFeed()
    await waitFor(() => expect(feedCalls().length).toBeGreaterThan(0))
    expect(feedCalls().every((u) => !u.includes('tags=AI'))).toBe(true)
    expect(JSON.parse(localStorage.getItem('daatan_feed_tags')!)).toEqual(['AI'])
  })

  it('guest: toggling and clearing a tag is remembered, clear persists an empty list', async () => {
    renderFeed()
    fireEvent.click(screen.getByTitle(messages.feed.filterHints.tags))
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(JSON.parse(localStorage.getItem('daatan_feed_tags')!)).toEqual(['AI'])

    fireEvent.click(screen.getByLabelText('Clear all selected tags'))
    expect(JSON.parse(localStorage.getItem('daatan_feed_tags')!)).toEqual([])
  })

  it('signed in: restores from the account and saves toggles there, not to localStorage', async () => {
    vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' } as never)
    respond({ feedTags: ['Economy'] })
    renderFeed()
    await waitFor(() => expect(feedCalls().some((u) => u.includes('tags=Economy'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    await waitFor(() => expect(prefPatches()).toHaveLength(1))
    expect(JSON.parse(prefPatches()[0][1].body)).toEqual({ feedTags: ['Economy', 'AI'] })
    expect(localStorage.getItem('daatan_feed_tags')).toBeNull()
  })
})
