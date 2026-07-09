import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import UsersTable from '../UsersTable'

const mockFetch = vi.fn()

const user = (overrides = {}) => ({
  id: 'u1', name: 'Jane Doe', username: 'jane', email: 'jane@example.com',
  role: 'USER', rs: 1500, createdAt: '2026-06-01T00:00:00.000Z', image: null, isBot: false,
  ...overrides,
})

describe('UsersTable', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
  })

  it('shows the total user count above the table', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ users: [user()], pages: 3, total: 47 }),
    })

    render(<UsersTable />)

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument())
    expect(screen.getByText('47 users')).toBeInTheDocument()
  })

  it('uses singular "user" when the total is exactly 1', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ users: [user()], pages: 1, total: 1 }),
    })

    render(<UsersTable />)

    await waitFor(() => expect(screen.getByText('1 user')).toBeInTheDocument())
  })
})
