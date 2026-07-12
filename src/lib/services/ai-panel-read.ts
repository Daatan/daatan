import { prisma } from '@/lib/prisma'
import {
  panelSeriesLabel,
  panelSeriesColor,
  isControlModel,
  PANEL_MEMBERS,
  GROUNDED_PANEL_MEMBERS,
} from '@/lib/llm/panel/roster'

/** One member's time series for the chart: only its real, non-abstained estimates. */
export interface PanelMemberSeries {
  model: string
  /** 'ungrounded' or 'grounded-indexer' — a grounded twin is its own series (§9a). */
  mode: string
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
      mode: true,
      probability: true,
      run: { select: { createdAt: true } },
    },
    orderBy: { run: { createdAt: 'asc' } },
  })

  // Keyed by (model, mode): a grounded twin shares its sibling's model string but is
  // its own line — merging them would splice two different information regimes.
  const byMember = new Map<string, PanelMemberSeries>()
  for (const e of estimates) {
    if (e.probability == null) continue
    const key = `${e.model}:${e.mode}`
    let series = byMember.get(key)
    if (!series) {
      series = {
        model: e.model,
        mode: e.mode,
        label: panelSeriesLabel(e.model, e.mode),
        color: panelSeriesColor(e.model, e.mode),
        // The control member is labelled as such so a viewer doesn't read it as a
        // peer. Read from the roster's flag — never re-derived from the model name.
        isControl: isControlModel(e.model),
        points: [],
      }
      byMember.set(key, series)
    }
    series.points.push({ createdAt: e.run.createdAt.toISOString(), probability: e.probability })
  }

  // Prefix labels collide when a member is renamed (qwen/… → qwen.…) and both have
  // history on this forecast: keep the plain label for the current roster member and
  // mark the retired series, so two "Qwen" lines stay distinguishable in the legend.
  const labelCounts = new Map<string, number>()
  for (const s of byMember.values()) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1)
  const rosters = [...PANEL_MEMBERS, ...GROUNDED_PANEL_MEMBERS]
  for (const s of byMember.values()) {
    if (
      (labelCounts.get(s.label) ?? 0) > 1 &&
      !rosters.some((m) => m.model === s.model && m.mode === s.mode)
    ) {
      s.label = `${s.label} (legacy)`
    }
  }

  // Stable order: roster position (via colour index is fragile), so sort by label.
  return [...byMember.values()].sort((a, b) => a.label.localeCompare(b.label))
}
