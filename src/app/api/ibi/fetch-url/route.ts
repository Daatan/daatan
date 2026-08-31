import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { getOracleBaseUrl, logOracleCall } from '@/lib/services/oracleClient'

const schema = z.object({ url: z.string().url() })

export const POST = withAuth(async (request, user) => {
  try {
    const body = await request.json()
    const { url } = schema.parse(body)

    // This endpoint is unauthenticated on the Oracul side (no x-api-key).
    const baseUrl = getOracleBaseUrl()
    if (!baseUrl) return NextResponse.json({ error: 'Oracul not configured' }, { status: 503 })

    const t0 = Date.now()
    const res = await fetch(`${baseUrl}/fetch-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15_000),
    })
    void logOracleCall({
      callType: 'FETCH_URL', status: res.ok ? 'OK' : 'ERROR', meta: { source: 'ibi-fetch-url', userId: user.id },
      durationMs: Date.now() - t0, httpStatus: res.status, query: url,
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
    return handleRouteError(error, 'fetch-url proxy failed')
  }
}, { roles: ['ADMIN'] })
