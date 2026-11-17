import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { z } from 'zod'
import { getForecastById, updateForecastStatus, deleteForecast } from '@/lib/services/forecast'
import { notifySearchEngines } from '@/lib/services/indexnow'
import { getRetroSimulation } from '@/lib/services/retro-simulation'

const updateStatusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PENDING', 'PENDING_APPROVAL', 'RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']),
})

export const PATCH = withAuth(async (req, user, { params }) => {
  const { id } = params
  const body = await req.json()

  const result = updateStatusSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (user.role === 'APPROVER') {
    const prediction = await getForecastById(id)
    if (!prediction) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (prediction.status !== 'PENDING_APPROVAL' || result.data.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Approvers can only approve pending forecasts' }, { status: 403 })
    }
  }

  // daatan#2217: a retro simulation must never become live — it would take evidence and
  // refresh its as-of number. It leaves PENDING_APPROVAL only through approve/reject.
  if (
    (result.data.status === 'ACTIVE' || result.data.status === 'PENDING') &&
    (await getRetroSimulation(id))
  ) {
    return NextResponse.json({ error: 'A retro simulation cannot be made live' }, { status: 409 })
  }

  const prediction = await updateForecastStatus(id, result.data.status)

  if (result.data.status === 'VOID' || result.data.status === 'UNRESOLVABLE') {
    notifySearchEngines(prediction.slug ?? prediction.id)
  }

  return NextResponse.json(prediction)
}, { roles: ['ADMIN', 'RESOLVER', 'APPROVER'] })

// Delete a prediction (admin only)
export const DELETE = withAuth(async (_req, _user, { params }) => {
  const { id } = params

  const deleted = await deleteForecast(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}, { roles: ['ADMIN'] })
