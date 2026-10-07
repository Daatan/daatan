import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastCard, { Prediction } from '../ForecastCard'
import messages from '../../../../messages/en.json'

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const claim = 'A ceasefire lasting more than one week will not be implemented between Russia and Ukraine by December 31, 2026'
const base: Prediction = {
  id: 'pred-1',
  claimText: claim,
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: new Date().toISOString(),
  author: { id: 'u1', name: 'Author', username: 'author', image: null, rs: 100, role: 'USER' },
  newsAnchor: null,
  tags: [],
  _count: { commitments: 0 },
}

// daatan#1814: the headline is the card title, and the full claim is still shown under it.
describe('ForecastCard headline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as ReturnType<typeof useSession>)
  })

  it('shows the headline as the title and the full claim below it', () => {
    renderWithIntl(<ForecastCard prediction={{ ...base, headline: 'No ceasefire this year' }} />)
    expect(screen.getByTestId('forecast-headline')).toHaveTextContent('No ceasefire this year')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('No ceasefire this year')
    expect(screen.getByText(claim)).toBeInTheDocument()
  })

  it('falls back to the claim as the title when there is no headline', () => {
    renderWithIntl(<ForecastCard prediction={{ ...base, headline: null }} />)
    expect(screen.queryByTestId('forecast-headline')).toBeNull()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(claim)
  })
})
