import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { CUTOFF_STATUSES, recordOutcomeCutoff } from '@/lib/services/outcome-cutoff'

const bodySchema = z
  .object({
    status: z.enum(CUTOFF_STATUSES),
    // Must carry an explicit offset: a bare local time is exactly the ambiguity this guards.
    cutoffAt: z.string().datetime({ offset: true }).optional(),
    basis: z.string().trim().min(20).max(4000),
    evidenceUrls: z.array(z.string().url()).max(20).default([]),
  })
  .refine((b) => b.status !== 'approved' || (b.cutoffAt != null && b.evidenceUrls.length > 0), {
    message: 'An approved cutoff needs cutoffAt and at least one evidence URL',
  })

/**
 * GET /api/admin/forecasts/[id]/outcome-cutoff — every cutoff decision for a forecast,
 * newest first (the newest one is in force).
 */
export const GET = withAuth(
  async (_request, _user, { params }) => {
    const rows = await prisma.predictionOutcomeCutoff.findMany({
      where: { predictionId: params.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ cutoffs: rows })
  },
  { roles: ['ADMIN'] },
)

/**
 * POST /api/admin/forecasts/[id]/outcome-cutoff
 * Record when a forecast's outcome became publicly known (daatan#2144) — the earliest
 * reliably verifiable confirmation, with its evidence — or record that no reliable cutoff
 * can be established (`insufficient`). Append-only: a correction is another POST.
 */
export const POST = withAuth(
  async (request, user, { params }) => {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const exists = await prisma.prediction.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!exists) return apiError('Forecast not found', 404)

    const { status, cutoffAt, basis, evidenceUrls } = parsed.data
    const row = await recordOutcomeCutoff({
      predictionId: params.id,
      status,
      cutoffAt: cutoffAt ? new Date(cutoffAt) : null,
      basis,
      evidenceUrls,
      recordedBy: user.id,
    })
    return NextResponse.json({ cutoff: row }, { status: 201 })
  },
  { roles: ['ADMIN'] },
)
