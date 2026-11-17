import { prisma } from '@/lib/prisma'

/**
 * Retro simulations (daatan#2217): a forecast built after an event, from articles published
 * before its as-of date only. Approving one does not publish it — it resolves it to the
 * recorded outcome in one step, straight from PENDING_APPROVAL, so it never passes through a
 * state where it could take a stake, receive evidence, refresh its Oracul number, reach the
 * calibration record or be announced. See the `RetroSimulation` model.
 */

export const RETRO_RESOLUTION_NOTE =
  'Retro simulation (daatan#2217): resolved at approval from the recorded outcome.'

export async function getRetroSimulation(predictionId: string) {
  return prisma.retroSimulation.findUnique({ where: { predictionId } })
}

export type ApproveRetroResult =
  | { ok: true; prediction: { id: string; slug: string | null; status: string } }
  | { ok: false; error: string; status: number }

export async function approveRetroSimulation(
  predictionId: string,
  approverId: string,
): Promise<ApproveRetroResult> {
  const retro = await getRetroSimulation(predictionId)
  if (!retro) return { ok: false, error: 'Not a retro simulation', status: 400 }

  const status = retro.outcome === 'correct' ? 'RESOLVED_CORRECT' : 'RESOLVED_WRONG'
  // Conditional on PENDING_APPROVAL so a concurrent approve/reject can't resolve it twice.
  const { count } = await prisma.prediction.updateMany({
    where: { id: predictionId, status: 'PENDING_APPROVAL' },
    data: {
      status,
      isPublic: false,
      resolvedAt: new Date(),
      resolvedById: approverId,
      resolutionOutcome: retro.outcome,
      resolutionNote: RETRO_RESOLUTION_NOTE,
    },
  })
  if (count === 0) return { ok: false, error: 'Forecast is not awaiting approval', status: 400 }

  const prediction = await prisma.prediction.findUniqueOrThrow({
    where: { id: predictionId },
    select: { id: true, slug: true, status: true },
  })
  return { ok: true, prediction }
}
