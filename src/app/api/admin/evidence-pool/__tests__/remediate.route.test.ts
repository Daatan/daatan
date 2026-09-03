import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/services/pool-remediate', () => ({
  remediatePool: vi.fn(),
  remediableWhere: () => ({ scope: 'a6' }),
  usablePoolWhere: () => ({ scope: 'usable' }),
  amnestyWhere: () => ({ scope: 'amnesty' }),
}))

import { remediatePool } from '@/lib/services/pool-remediate'
import { POST } from '../remediate/route'

const remediate = vi.mocked(remediatePool)

function req(body: unknown, headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  return new NextRequest('http://localhost/api/admin/evidence-pool/remediate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/evidence-pool/remediate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    remediate.mockResolvedValue({ mode: 'dry-run', forecasts: [] })
  })

  it('defaults to dry-run when mode is omitted', async () => {
    // The safety property of the whole route: a call that forgets the flag reads the
    // target set and writes nothing. Remediation is gated on a human reviewing the
    // previewed swings, and the gate is in front of this route, not inside it.
    const res = await POST(req({ ids: ['p1'] }))

    expect(res.status).toBe(200)
    expect(remediate).toHaveBeenCalledWith(['p1'], false, { scope: 'a6' })
  })

  it('applies only on an explicit mode=apply', async () => {
    await POST(req({ ids: ['p1', 'p2'], mode: 'apply' }))

    expect(remediate).toHaveBeenCalledWith(['p1', 'p2'], true, { scope: 'a6' })
  })

  it('defaults scope to the A6 signature when omitted', async () => {
    await POST(req({ ids: ['p1'] }))

    expect(remediate).toHaveBeenCalledWith(['p1'], false, { scope: 'a6' })
  })

  it('targets the full usable pool on scope=usable', async () => {
    await POST(req({ ids: ['p1'], scope: 'usable' }))

    expect(remediate).toHaveBeenCalledWith(['p1'], false, { scope: 'usable' })
  })

  it('targets the amnesty scope on scope=amnesty', async () => {
    await POST(req({ ids: ['p1'], scope: 'amnesty' }))

    expect(remediate).toHaveBeenCalledWith(['p1'], false, { scope: 'amnesty' })
  })

  it('rejects an unrecognised scope', async () => {
    const res = await POST(req({ ids: ['p1'], scope: 'everything' }))

    expect(res.status).toBe(400)
    expect(remediate).not.toHaveBeenCalled()
  })

  it('rejects an unrecognised mode rather than falling back to dry-run', async () => {
    // A typo'd "aply" that silently no-ops reads as "the remediation ran and changed
    // nothing" — the one wrong answer this route must never give.
    const res = await POST(req({ ids: ['p1'], mode: 'aply' }))

    expect(res.status).toBe(400)
    expect(remediate).not.toHaveBeenCalled()
  })

  it('rejects a missing or empty id list', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ ids: [] }))).status).toBe(400)
    expect((await POST(req({ ids: 'p1' }))).status).toBe(400)
    expect(remediate).not.toHaveBeenCalled()
  })

  it('caps the batch so one call cannot queue an unbounded number of Oracul analyses', async () => {
    const res = await POST(req({ ids: Array.from({ length: 11 }, (_, i) => `p${i}`), mode: 'apply' }))

    expect(res.status).toBe(400)
    expect(remediate).not.toHaveBeenCalled()
  })

  it('falls through to session auth without the cron secret', async () => {
    const res = await POST(req({ ids: ['p1'] }, {}))

    expect(res.status).toBe(401)
    expect(remediate).not.toHaveBeenCalled()
  })
})
