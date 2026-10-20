import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { createCommitmentSchema, updateCommitmentSchema } from '@/lib/validations/prediction'
import { handleRouteError } from '@/lib/api-error'
import { createCommitment, removeCommitment, updateCommitment } from '@/lib/services/commitment'


// POST /api/forecasts/[id]/commit - Commit CU to a prediction
export const POST = withAuth(async (request, user, { params }) => {
  try {
    const body = await request.json()
    const data = createCommitmentSchema.parse(body)

    const result = await createCommitment(user.id, params.id, data)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to create commitment')
  }
})

// DELETE /api/forecasts/[id]/commit - Remove commitment (only if prediction not locked)
export const DELETE = withAuth(async (_request, user, { params }) => {
  try {
    const result = await removeCommitment(user.id, params.id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to remove commitment')
  }
})

// PATCH /api/forecasts/[id]/commit - Update existing commitment
export const PATCH = withAuth(async (request, user, { params }) => {
  try {
    const body = await request.json()
    const data = updateCommitmentSchema.parse(body)

    const result = await updateCommitment(user.id, params.id, data)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to update commitment')
  }
})
