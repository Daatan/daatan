import { render, screen } from '@testing-library/react'
import { UserProfileView } from '../UserProfileView'
import { describe, it, expect, vi } from 'vitest'
import type { ProfileScores, ProfileTabResult } from '@/lib/services/profile'

// Mock next-intl — resolve real en.json `profile` values so translated strings
// render as English in assertions (with basic {var} interpolation + .raw).
vi.mock('next-intl/server', async () => {
  const en = (await import('../../../../messages/en.json')).default
  const dict = ((en as Record<string, unknown>).profile ?? {}) as Record<string, string>
  const t = (key: string, vars?: Record<string, string | number>) => {
    let msg = dict[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return msg
  }
  t.raw = (key: string) => dict[key] ?? key
  return { getTranslations: () => Promise.resolve(t), getLocale: () => Promise.resolve('en') }
})

// Mock next/image
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock RoleBadge
vi.mock('@/components/RoleBadge', () => ({
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}))

// Mock ForecastCard
vi.mock('@/components/forecasts/ForecastCard', () => ({
  default: ({ prediction }: { prediction: { claimText: string } }) => (
    <div data-testid="forecast-card">{prediction.claimText}</div>
  ),
}))

// Mock EmptyState
vi.mock('@/components/ui/EmptyState', () => ({
  default: ({ description }: { description: string }) => <div>{description}</div>,
}))

// Mock TagFilter
vi.mock('@/components/profile/TagFilter', () => ({
  TagFilter: () => null,
}))

// Mock ScoresGrid
vi.mock('@/components/profile/ScoresGrid', () => ({
  ScoresGrid: () => <div data-testid="scores-grid" />,
}))

// Mock ProfileTabs
vi.mock('@/components/profile/ProfileTabs', () => ({
  ProfileTabs: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="profile-tabs">{children}</div>
  ),
}))

// Mock ShareProfileButton
vi.mock('@/components/profile/ShareProfileButton', () => ({
  ShareProfileButton: ({ username }: { username: string }) => (
    <button data-testid="share-profile-button">Share {username}</button>
  ),
}))

describe('UserProfileView Component', () => {
  const mockUser = {
    id: 'user-1',
    name: 'Test User',
    username: 'testuser',
    image: 'https://example.com/image.jpg',
    role: 'USER',
    website: null,
    twitterHandle: null,
    rs: 150.5,
    mu: 1500,
    sigma: 350,
    eloRating: 1500,
    createdAt: new Date('2025-01-01').toISOString(),
    _count: { predictions: 10, commitments: 5 },
  }

  const mockScores: ProfileScores = {
    avgBrierScore: null,
    brierCount: 0,
    peerScoreSum: null,
    peerScoreCount: 0,
    aiScoreSum: null,
    aiScoreCount: 0,
    rsTagDelta: null,
    truthScore: null,
    weightedPeerScore: null,
    weightedPeerCount: 0,
    roi: null,
    accuracy: null,
    accuracyResolved: 0,
    topicBreakdown: [],
    calibration: [],
  }

  const mockTabData: ProfileTabResult = {
    tab: 'created',
    page: 1,
    createdTotal: 0,
    participatedTotal: 0,
    resolvedTotal: 0,
    createdItems: [],
    participatedItems: [],
    resolvedItems: [],
  }

  it('renders user information correctly', async () => {
    const component = await UserProfileView({
      user: mockUser,
      isOwnProfile: true,
      userTags: [],
      selectedTag: null,
      scores: mockScores,
      tabData: { ...mockTabData, createdTotal: 3 },
    })

    render(component)

    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('@testuser')).toBeInTheDocument()
    expect(screen.getByText('1500')).toBeInTheDocument() // Glicko-2 μ in skill card
  })

  it('renders "Edit profile" link only for own profile', async () => {
    const ownProfile = await UserProfileView({
      user: mockUser,
      isOwnProfile: true,
      userTags: [],
      selectedTag: null,
      scores: mockScores,
      tabData: mockTabData,
    })

    const { rerender } = render(ownProfile)
    const editLink = screen.getAllByRole('link').find(l => l.getAttribute('href') === '/profile/edit')
    expect(editLink).toBeInTheDocument()

    const publicProfile = await UserProfileView({
      user: mockUser,
      isOwnProfile: false,
      userTags: [],
      selectedTag: null,
      scores: mockScores,
      tabData: mockTabData,
    })

    rerender(publicProfile)
    const publicEditLink = screen
      .queryAllByRole('link')
      .find(l => l.getAttribute('href') === '/profile/edit')
    expect(publicEditLink).toBeUndefined()
  })

  it('renders created tab forecast list', async () => {
    const withItems: ProfileTabResult = {
      ...mockTabData,
      createdTotal: 1,
      createdItems: [{ id: 'p1', claimText: 'Forecast 1' } as never],
    }

    const component = await UserProfileView({
      user: mockUser,
      isOwnProfile: false,
      userTags: [],
      selectedTag: null,
      scores: mockScores,
      tabData: withItems,
    })

    render(component)
    expect(screen.getByText('Forecast 1')).toBeInTheDocument()
  })

  it('shows Glicko-2 skill rating and no CU balance', async () => {
    const component = await UserProfileView({
      user: mockUser,
      isOwnProfile: false,
      userTags: [],
      selectedTag: null,
      scores: mockScores,
      tabData: mockTabData,
    })

    render(component)
    expect(screen.getByText('1500')).toBeInTheDocument() // Glicko-2 μ
    expect(screen.getByText(/Skill Rating/i)).toBeInTheDocument()
    expect(screen.queryByText(/CU/)).not.toBeInTheDocument()
  })
})
