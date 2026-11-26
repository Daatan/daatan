import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'

// daatan#2333: the landing renders its own topic chips, so they need the same translation as the
// feeds (#2330). Server components here: call them, then render what they return.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const messages = {
    en: (await import('../../../../messages/en.json')).default,
    he: (await import('../../../../messages/he.json')).default,
  }
  return {
    getTranslations: async ({ locale, namespace }: { locale: 'en' | 'he'; namespace: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  }
})
vi.mock('@/lib/services/crawl-links', () => ({ getRecentForecastLinks: vi.fn(), getVisibleTagLinks: vi.fn() }))

import LatestForecasts from '../LatestForecasts'
import { ForecastCard, SourceCard } from '../cards'
import { buildLinks } from '../links'
import he from '../../../../messages/he.json'

describe('landing topic labels (daatan#2333)', () => {
  it('translates standard topics in the Topics row and keeps other tags as stored', async () => {
    const el = await LatestForecasts({
      locale: 'he',
      links: buildLinks('he'),
      forecasts: [],
      tags: [{ name: 'Geopolitics', slug: 'geopolitics', count: 9 }, { name: 'Chess', slug: 'chess', count: 2 }],
    })
    render(el as ReactElement)
    expect(screen.getByRole('link', { name: he.topics.names.geopolitics })).toHaveAttribute('href', '/tags/geopolitics')
    expect(screen.getByRole('link', { name: 'Chess' })).toBeInTheDocument()
  })

  it('translates topics on the featured cards', async () => {
    render(
      (await ForecastCard({
        locale: 'he',
        data: { tags: ['politics', 'Israeli Elections 2026'], statement: 's', confidence: 40, resolvesOn: '2026-12-31', open: true },
      })) as ReactElement,
    )
    expect(screen.getByText(he.topics.names.politics)).toBeInTheDocument()
    expect(screen.getByText(he.topics.names['israeli-elections-2026'])).toBeInTheDocument()

    render(
      (await SourceCard({
        locale: 'he',
        data: { name: 'n', saidOn: '2026-01-01', statement: 's', whatHappened: 'w', verdict: 'correct', tag: 'Middle East', record: [true] },
      })) as ReactElement,
    )
    expect(document.body.textContent).toContain(he.topics.names['middle-east'])
  })
})
