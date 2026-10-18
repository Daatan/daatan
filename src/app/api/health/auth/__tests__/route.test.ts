import { describe, it, expect, vi } from 'vitest'

const SECRET = 'GOCSPX-abcdefghijklmnopqrstuvwxyz123'

vi.mock('@/env', () => ({
  env: {
    GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-abcdefghijklmnopqrstuvwxyz123',
    NEXTAUTH_SECRET: 'n'.repeat(64),
    NEXTAUTH_URL: 'https://example.test',
    DAATAN_EDITION: 'saas',
  },
}))

import { GET } from '../route'

describe('GET /api/health/auth', () => {
  it('reports configuration without echoing any fragment of a secret', async () => {
    const res = await GET(new Request('http://localhost/api/health/auth'))
    const text = await res.text()
    const body = JSON.parse(text)

    expect(res.status).toBe(200)
    expect(body.diagnostics.GOOGLE_CLIENT_SECRET).toEqual({ set: true, length: SECRET.length })
    expect(body.diagnostics.NEXTAUTH_SECRET).toEqual({ set: true, length: 64 })
    // First/last characters of the secret must never appear in the public response.
    expect(text).not.toContain(SECRET.slice(0, 4))
    expect(text).not.toContain(SECRET.slice(-4))
  })
})
