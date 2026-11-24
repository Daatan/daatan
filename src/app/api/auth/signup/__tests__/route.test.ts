import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRegisterUser, mockFindUsernameCollisions } = vi.hoisted(() => ({
  mockRegisterUser: vi.fn(),
  mockFindUsernameCollisions: vi.fn(),
}))
vi.mock('@/lib/services/user', () => ({
  findUserByEmail: vi.fn().mockResolvedValue(null),
  findUsernameCollisions: mockFindUsernameCollisions,
  registerUser: mockRegisterUser,
}))
vi.mock('@/lib/services/telegram', () => ({ notifyNewUserRegistered: vi.fn() }))
vi.mock('@/lib/services/invite', () => ({ consumeInvite: vi.fn().mockResolvedValue(true) }))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed') } }))

import { POST } from '../route'
import { resetRateLimitStore } from '@/lib/rate-limit'

const signup = (name: string) => POST(new NextRequest('http://localhost/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ name, email: 'someone@example.com', password: 'Correct-Horse-9-Battery' }),
}))

describe('POST /api/auth/signup — the Daatan account name is reserved (#2301)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitStore()
    mockFindUsernameCollisions.mockResolvedValue([])
    mockRegisterUser.mockImplementation(async (d) => ({ id: 'u1', email: d.email, name: d.name, username: d.username }))
  })

  it('never hands a new user the username or slug "daatan", even when it is free', async () => {
    const res = await signup('Daatan')
    expect(res.status).toBe(201)
    const data = mockRegisterUser.mock.calls[0][0]
    expect(data.username).toBe('daatan1')
    expect(data.slug).toBe('daatan-1')
  })

  it('leaves other names alone', async () => {
    await signup('Dana')
    expect(mockRegisterUser.mock.calls[0][0]).toMatchObject({ username: 'dana', slug: 'dana' })
  })
})
