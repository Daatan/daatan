import { prisma } from '@/lib/prisma'
import { panelMemberLabel, panelMemberColor } from '@/lib/llm/panel/roster'

/** One member's time series for the chart: only its real, non-abstained estimates. */
export interface PanelMemberSeries {
  model: string
  label: string
  color: string
  isControl: boolean
  points: { createdAt: string; probability: number }[]
}

/**
 * Per-member panel history for one forecast, oldest first, ready for the chart.
 *
 * Read-only and isolation-preserving: this touches ONLY `ai_estimates` — never
 * `Prediction.confidence` or the Oracle's `ContextSnapshot`. The panel is a separate
 * source (docs/LASSO.md §1), so nothing here can move the needle or the Oracle line.
 *
 * Abstentions (`insufficientData`, null probability) are dropped: a member that declined
 * has no point to plot, exactly as the Oracle line skips its abstained snapshots. A
 * member is omitted entirely if it never produced a number, so the legend shows only
 * members with something to say.
 */
export async function getPanelSeries(predictionId: string): Promise<PanelMemberSeries[]> {
  const estimates = await prisma.aiEstimate.findMany({
    where: {
      run: { predictionId },
      insufficientData: false,
      probability: { not: null },
    },
    select: {
      model: true,
      probability: true,
      run: { select: { createdAt: true } },
    },
    orderBy: { run: { createdAt: 'asc' } },
  })

  const byModel = new Map<string, PanelMemberSeries>()
  for (const e of estimates) {
    if (e.probability == null) continue
    let series = byModel.get(e.model)
    if (!series) {
      series = {
        model: e.model,
        label: panelMemberLabel(e.model),
        color: panelMemberColor(e.model),
        // A 4B control model is labelled as such so a viewer doesn't read it as a peer.
        isControl: e.model.startsWith('google/gemma'),
        points: [],
      }
      byModel.set(e.model, series)
    }
    series.points.push({ createdAt: e.run.createdAt.toISOString(), probability: e.probability })
  }

  // Stable order: roster position (via colour index is fragile), so sort by label.
  return [...byModel.values()].sort((a, b) => a.label.localeCompare(b.label))
}
