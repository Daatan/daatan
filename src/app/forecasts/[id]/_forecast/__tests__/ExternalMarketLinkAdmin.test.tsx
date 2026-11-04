import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { ExternalMarketLinkAdmin } from '../ExternalMarketLinkAdmin'
import type { Prediction } from '../types'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const prediction = { id: 'pred-1', externalMarket: null } as unknown as Prediction
const marketUrl = 'https://polymarket.com/event/some-event/some-market'
const question = 'Will the thing happen?'

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u1', role: 'ADMIN' } }, status: 'authenticated' } as never)
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      suggestions: [{ provider: 'POLYMARKET', externalId: '1', slug: 'some-market', question, yesProbability: 42, url: marketUrl, score: 80 }],
    }),
  }) as never
})

async function showSuggestions() {
  render(<ExternalMarketLinkAdmin prediction={prediction} />)
  fireEvent.click(screen.getByRole('button', { name: /link external market/i }))
  fireEvent.click(screen.getByRole('button', { name: /suggest matches/i }))
  return screen.findByRole('link', { name: new RegExp(question.replace('?', '\\?')) })
}

describe('ExternalMarketLinkAdmin suggestions', () => {
  it('opens a suggested market in a new tab', async () => {
    const link = await showSuggestions()
    expect(link).toHaveAttribute('href', marketUrl)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not link the market when its question is clicked', async () => {
    const link = await showSuggestions()
    vi.mocked(global.fetch).mockClear()
    fireEvent.click(link)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('links the market through the explicit Link button', async () => {
    await showSuggestions()
    vi.mocked(global.fetch).mockClear()
    fireEvent.click(screen.getByRole('button', { name: `Link ${question}` }))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/forecasts/pred-1/external-market',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: marketUrl }) }),
    )
  })
})
