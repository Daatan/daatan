import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { EvidencePoolAdmin } from '../EvidencePoolAdmin'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const asAdmin = () =>
  vi.mocked(useSession).mockReturnValue({
    data: { user: { id: 'u1', role: 'ADMIN' } },
    status: 'authenticated',
  } as never)

const article = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  url: 'https://example.com/a',
  title: 'Example article',
  source: 'example.com',
  publishedDate: '2026-08-01',
  stance: 0.5,
  certainty: 0.8,
  origin: 'analyze',
  excluded: false,
  version: 1,
  supersedesId: null,
  supersededAt: null,
  ...overrides,
})

const globalFetch = global.fetch
afterEach(() => {
  global.fetch = globalFetch
})
beforeEach(() => {
  vi.clearAllMocks()
})

async function openPanel() {
  await act(async () => {
    screen.getByText('Evidence pool').click()
  })
}

describe('EvidencePoolAdmin — version chains', () => {
  it('renders a plain row with no correction indicator for an unversioned article (version=1, no chain)', async () => {
    asAdmin()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [article()] }) })
    render(<EvidencePoolAdmin predictionId="pred-1" />)
    await openPanel()

    expect(await screen.findByText('Example article')).toBeInTheDocument()
    expect(screen.queryByText(/correction/i)).toBeNull()
  })

  it('groups a version chain under its current head and hides prior readings until expanded', async () => {
    asAdmin()
    const head = article({
      id: 'a2',
      title: 'Corrected article',
      version: 2,
      supersedesId: 'a1-old',
      supersededAt: null,
      stance: 0.9,
    })
    const prior = article({
      id: 'a1-old',
      title: 'Corrected article (original)',
      version: 1,
      supersedesId: null,
      supersededAt: '2026-08-10T12:00:00.000Z',
      stance: -0.2,
      certainty: 0.4,
    })
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ articles: [head, prior] }) })
    render(<EvidencePoolAdmin predictionId="pred-1" />)
    await openPanel()

    expect(await screen.findByText('Corrected article')).toBeInTheDocument()
    // Only the head renders as its own row; the prior isn't a separate top-level row.
    expect(screen.queryByText('Corrected article (original)')).toBeNull()
    expect(screen.getByText(/1 correction/i)).toBeInTheDocument()

    await act(async () => {
      screen.getByText(/1 correction/i).click()
    })

    expect(screen.getByText(/previous reading/i)).toBeInTheDocument()
    expect(screen.getByText(/stance -0.20 \/ certainty 0.40/)).toBeInTheDocument()
  })

  it('still renders a superseded row standalone if its head is missing from the response (defensive)', async () => {
    asAdmin()
    const orphan = article({ id: 'orphan', supersededAt: '2026-08-01T00:00:00.000Z', title: 'Orphan row' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [orphan] }) })
    render(<EvidencePoolAdmin predictionId="pred-1" />)
    await openPanel()

    expect(await screen.findByText('Orphan row')).toBeInTheDocument()
  })
})
