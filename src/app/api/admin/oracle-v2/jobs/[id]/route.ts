import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'

/** Admin-only proxy: read an Oracle 2.0 playground job trace (retro#595). */
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async (_request, _user, { params }) => {
    try {
      const id = params.id
      if (!/^[a-f0-9]{6,32}$/i.test(id)) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
      const cfg = getOracleConfig()
      if (!cfg) return NextResponse.json({ error: 'Oracle not configured' }, { status: 503 })
      const res = await oracleFetch(cfg, `/v2/jobs/${id}`, { timeoutMs: 15_000 })
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
