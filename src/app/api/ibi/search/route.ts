import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { getOracleConfig, oracleFetch, logOracleCall } from '@/lib/services/oracleClient'

const schema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
  date_to: z.string().optional(),
})

export const POST = withAuth(async (request, user) => {
  try {
    const body = await request.json()
    const payload = schema.parse(body)

    const cfg = getOracleConfig()
    if (!cfg) return NextResponse.json({ error: 'Oracul not configured' }, { status: 503 })

    const t0 = Date.now()
    const res = await oracleFetch(cfg, '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    })
    void logOracleCall({
      callType: 'SEARCH', status: res.ok ? 'OK' : 'ERROR', meta: { source: 'ibi-search', userId: user.id },
      durationMs: Date.now() - t0, httpStatus: res.status, query: payload.query,
    })

    const text = await res.text()
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status })
    } catch {
      return NextResponse.json(
        { error: 'Oracul returned a non-JSON response' },
        { status: res.status >= 400 ? res.status : 502 },
      )
    }
  } catch (error) {
    return handleRouteError(error, 'search proxy failed')
  }
}, { roles: ['ADMIN'] })
