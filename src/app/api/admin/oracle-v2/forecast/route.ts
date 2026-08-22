import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'

/**
 * Admin-only proxy to the Oracle 2.0 playground (retro#595): starts a job.
 * The browser never sees ORACLE_API_KEY — that is the whole point of having
 * this page inside daatan rather than on the public GitHub Pages site.
 */
const schema = z.object({
  question: z.string().min(5).max(1000),
  depth: z.number().int().min(1).max(6).default(2),
  max_precursors: z.number().int().min(1).max(10).default(5),
  max_forecast_calls: z.number().int().min(1).max(80).default(15),
  max_articles: z.number().int().min(3).max(30).default(10),
  claim_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  async (request) => {
    try {
      const payload = schema.parse(await request.json())
      const cfg = getOracleConfig()
      if (!cfg) return NextResponse.json({ error: 'Oracle not configured' }, { status: 503 })
      const res = await oracleFetch(cfg, '/v2/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 20_000,
      })
      const text = await res.text()
      try {
        return NextResponse.json(JSON.parse(text), { status: res.status })
      } catch {
        return NextResponse.json(
          { error: 'Oracle returned a non-JSON response' },
          { status: res.status >= 400 ? res.status : 502 },
        )
      }
    } catch (error) {
      return handleRouteError(error)
    }
  },
  { roles: ['ADMIN'] },
)
