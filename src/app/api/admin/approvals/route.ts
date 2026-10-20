import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { listPendingApprovals } from '@/lib/services/forecast'


// GET /api/admin/approvals — list PENDING_APPROVAL forecasts
export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1')
  const rawLimit = parseInt(searchParams.get('limit') || '20')
  const limit = Math.min(100, Math.max(1, rawLimit))

  const result = await listPendingApprovals({ page, limit })

  return NextResponse.json(result)
}, { roles: ['ADMIN', 'RESOLVER', 'APPROVER'] })
