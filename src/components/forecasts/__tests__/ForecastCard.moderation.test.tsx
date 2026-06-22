import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastCard, { Prediction } from '../ForecastCard'
import messages from '../../../../messages/en.json'

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

const basePrediction: Prediction = {
  id: 'pred-1',
  claimText: 'Test prediction',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: new Date().toISOString(),
  author: {
    id: 'user-1',
    name: 'Author',
    username: 'author',
    image: null,
    rs: 100,
    role: 'USER',
  },
  newsAnchor: null,
  tags: [],
  _count: {
    commitments: 0,
  },
  totalCuCommitted: 0,
  userHasCommitted: false,
}

describe('ForecastCard tag display', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)
  })

  it('renders tag pills when tags are present', () => {
    const prediction = {
      ...basePrediction,
      tags: [{ name: 'AI' }, { name: 'Crypto' }],
    }
    renderWithIntl(<ForecastCard prediction={prediction} />)

    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('Crypto')).toBeInTheDocument()
  })

  it('does not render tag section when tags array is empty', () => {
    renderWithIntl(<ForecastCard prediction={basePrediction} />)

    expect(screen.queryByText('AI')).toBeNull()
    expect(screen.queryByText('Crypto')).toBeNull()
  })

  it('does not render tag section when tags is undefined', () => {
    const { tags, ...predictionWithoutTags } = basePrediction
    renderWithIntl(<ForecastCard prediction={predictionWithoutTags as Prediction} />)

    expect(screen.queryByText('AI')).toBeNull()
  })
})

describe('ForecastCard moderation controls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does not show moderation controls when showModerationControls is false', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { role: 'ADMIN' },
        expires: 'any',
      } as any,
      status: 'authenticated',
    } as any)

    renderWithIntl(<ForecastCard prediction={basePrediction} />)

    expect(screen.queryByLabelText(/Admin actions/i)).toBeNull()
  })

  it('does not show Edit/Delete for resolvers but shows Resolve for active predictions', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { role: 'RESOLVER' },
        expires: 'any',
      } as any,
      status: 'authenticated',
    } as any)

    renderWithIntl(<ForecastCard prediction={basePrediction} showModerationControls />)

    const menuBtn = screen.getByLabelText(/Admin actions/i)
    fireEvent.click(menuBtn)

    expect(screen.queryByText(/^Edit$/i)).toBeNull()
    expect(screen.queryByText(/^Delete$/i)).toBeNull()
    expect(screen.getByText(/^Resolve$/i)).toBeInTheDocument()
  })

  it('does not show Resolve for resolved predictions', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { role: 'RESOLVER' },
        expires: 'any',
      } as any,
      status: 'authenticated',
    } as any)

    const resolvedPrediction = { ...basePrediction, status: 'RESOLVED_CORRECT' as const }
    renderWithIntl(<ForecastCard prediction={resolvedPrediction} showModerationControls />)

    expect(screen.queryByLabelText(/Admin actions/i)).toBeNull()
  })

  it('shows moderation controls for admins when flag is true', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { role: 'ADMIN' },
        expires: 'any',
      } as any,
      status: 'authenticated',
    } as any)

    renderWithIntl(<ForecastCard prediction={basePrediction} showModerationControls />)

    const menuBtn = screen.getByLabelText(/Admin actions/i)
    fireEvent.click(menuBtn)

    expect(screen.getByText(/^Resolve$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Edit$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Delete$/i)).toBeInTheDocument()
  })
})

describe('ForecastCard source badge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)
  })

  it('shows the personal-origin marker when source is manual and no news anchor', () => {
    const prediction = { ...basePrediction, source: 'manual', newsAnchor: null }
    renderWithIntl(<ForecastCard prediction={prediction} />)
    expect(screen.getByTestId('personal-origin')).toBeInTheDocument()
  })

  it('does not show the personal-origin marker when news anchor is present', () => {
    const prediction = {
      ...basePrediction,
      source: 'manual',
      newsAnchor: { id: 'a1', title: 'Some article', source: 'Reuters', imageUrl: null },
    }
    renderWithIntl(<ForecastCard prediction={prediction} />)
    expect(screen.queryByTestId('personal-origin')).toBeNull()
  })

  it('does not show the personal-origin marker when source is null', () => {
    const prediction = { ...basePrediction, source: null, newsAnchor: null }
    renderWithIntl(<ForecastCard prediction={prediction} />)
    expect(screen.queryByTestId('personal-origin')).toBeNull()
  })

  it('does not show the personal-origin marker when source is bot', () => {
    const prediction = { ...basePrediction, source: 'bot', newsAnchor: null }
    renderWithIntl(<ForecastCard prediction={prediction} />)
    expect(screen.queryByTestId('personal-origin')).toBeNull()
  })
})

