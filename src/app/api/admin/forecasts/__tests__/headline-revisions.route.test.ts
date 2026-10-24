import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
const { apply } = vi.hoisted(() => ({ apply: vi.fn() }))
vi.mock('@/lib/services/headline-revisions', () => ({ applyHeadlineRevisions: apply }))
vi.mock('@/lib/api-middleware', () => ({ withAuth: () => async () => new Response('no session', { status: 401 }) }))

import { POST } from '../headline-revisions/route'
import { HEADLINE_REVISIONS } from '@/lib/services/headline-revisions.data'
import { HEADLINE_REVISIONS_2 } from '@/lib/services/headline-revisions-2.data'

const req = (qs = '', secret: string | null = 'test-secret') =>
  new NextRequest(`http://localhost/api/admin/forecasts/headline-revisions${qs}`, {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })

describe('POST /api/admin/forecasts/headline-revisions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    apply.mockResolvedValue({ dryRun: true, counts: {}, rows: [] })
  })

  it('runs the newest batch as a dry run by default', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(apply).toHaveBeenCalledWith(HEADLINE_REVISIONS_2, '2026-10-active-2', { apply: false })
  })

  it('applies only with ?apply=1', async () => {
    await POST(req('?apply=1'))
    expect(apply).toHaveBeenCalledWith(HEADLINE_REVISIONS_2, '2026-10-active-2', { apply: true })
  })

  it('can still run the first batch by name', async () => {
    await POST(req('?batch=2026-10-active'))
    expect(apply).toHaveBeenCalledWith(HEADLINE_REVISIONS, '2026-10-active', { apply: false })
  })

  it('rejects an unknown batch, including inherited object keys', async () => {
    expect((await POST(req('?batch=nope'))).status).toBe(400)
    expect((await POST(req('?batch=constructor'))).status).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not run without the secret or an admin session', async () => {
    expect((await POST(req('', null))).status).toBe(401)
    expect((await POST(req('', 'wrong'))).status).toBe(401)
    expect(apply).not.toHaveBeenCalled()
  })
})
