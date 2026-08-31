import { NextResponse } from 'next/server'
import { OracleCallType, OracleCallStatus } from '@prisma/client'
import { withAuth } from '@/lib/api-middleware'
import { getOraculUsageStats } from '@/lib/services/oracleStats'

const VALID_CALL_TYPES = Object.values(OracleCallType) as string[]
const VALID_STATUSES = Object.values(OracleCallStatus) as string[]

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const raw = parseInt(searchParams.get('windowDays') || '30', 10)
  const windowDays = Math.min(30, Math.max(1, Number.isNaN(raw) ? 30 : raw))

  const source = searchParams.get('source') || undefined
  const callTypeParam = searchParams.get('callType') || undefined
  const callType = callTypeParam && VALID_CALL_TYPES.includes(callTypeParam)
    ? (callTypeParam as OracleCallType)
    : undefined
  const statusParam = searchParams.get('status') || undefined
  const status = statusParam && VALID_STATUSES.includes(statusParam)
    ? (statusParam as OracleCallStatus)
    : undefined

  const stats = await getOraculUsageStats(windowDays, { source, callType, status })
  return NextResponse.json(stats)
}, { roles: ['ADMIN'] })
