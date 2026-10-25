import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mockGetVisibleTagLinks } = vi.hoisted(() => ({ mockGetVisibleTagLinks: vi.fn() }))

vi.mock('@/lib/services/crawl-links', () => ({ getVisibleTagLinks: mockGetVisibleTagLinks }))
vi.mock('next/server', () => ({ connection: async () => undefined }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: { count?: number }) => (values?.count != null ? `${values.count} forecasts` : key),
}))
vi.mock('@/components/JsonLd', () => ({ JsonLd: () => null }))

import TagsIndexPage, { metadata } from '../page'

describe('/tags index', () => {
  beforeEach(() => vi.clearAllMocks())

  it('server-renders a link to every tag with visible forecasts', async () => {
    mockGetVisibleTagLinks.mockResolvedValue([
      { name: 'Israel', slug: 'israel', count: 12 },
      { name: 'AI', slug: 'ai', count: 3 },
    ])
    render(await TagsIndexPage())
    expect(screen.getByRole('link', { name: /Israel/ })).toHaveAttribute('href', '/tags/israel')
    expect(screen.getByRole('link', { name: /AI/ })).toHaveAttribute('href', '/tags/ai')
  })

  it('falls back to a forecasts link when there are no tags or the lookup fails', async () => {
    mockGetVisibleTagLinks.mockRejectedValue(new Error('db down'))
    render(await TagsIndexPage())
    expect(screen.getByRole('link', { name: 'browseForecasts' })).toHaveAttribute('href', '/forecasts')
  })

  it('is self-canonical', () => {
    expect(metadata.alternates?.canonical).toBe('/tags')
  })
})
