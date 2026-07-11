import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { getOpenRouterKey } from '@/lib/services/settings'
import { warmAwsSecrets } from '@/lib/aws/secrets'
import { callPanelMember, logMemberFailure, PanelAuthError } from '@/lib/llm/panel/client'
import { PANEL_MEMBERS, rosterSignature, type PanelMember } from '@/lib/llm/panel/roster'

const log = createLogger('ai-panel')

/** How many members to call at once. Small: five members × a few hundred forecasts is
 *  not latency-critical, and OpenRouter would rather we didn't burst. */
const MEMBER_CONCURRENCY = 3

export type PanelRunStatus =
  /** input hash unchanged since the last run — nothing to do, previous run stays current */
  | 'skipped-unchanged'
  /** another process wrote this exact run first (unique index on predictionId+inputHash) */
  | 'skipped-duplicate'
  /** every member's call threw; nothing written, so the next tick retries */
  | 'failed'
  | 'written'
  /** today's run existed but was missing members (they couldn't be authenticated when it
   *  was written); their estimates were appended in place. See the completion pass in
   *  `runPanelForPrediction`. */
  | 'completed-partial'
  | 'dry-run'

export interface PanelRunResult {
  predictionId: string
  status: PanelRunStatus
  /** Members that returned a number. */
  estimated: number
  /** Members that abstained: returned null, or their call failed. */
  abstained: number
}

export interface PanelPrediction {
  id: string
  claimText: string
  resolutionRules: string | null
  resolveByDatetime: Date
}

/** Fingerprint of the prompt template. Part of member identity — a prompt change
 *  makes prior Brier scores incomparable, so it is stored on every estimate.
 *  Derived from the template text rather than a Bedrock version id so it stays
 *  correct when the hardcoded fallback prompt is in use. */
export function promptVersionOf(template: string): string {
  return createHash('sha256').update(template).digest('hex').slice(0, 12)
}

/** UTC calendar day. Day granularity, not timestamp: the prompt only ever shows the
 *  model a date, so a finer clock would force sweeps that cannot change the answer. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function daysRemaining(resolveBy: Date, now: Date): number {
  return Math.max(0, Math.ceil((resolveBy.getTime() - now.getTime()) / 86_400_000))
}

/**
 * The date-gate. The panel prompt carries no article text, so the only input that
 * changes over a forecast's life is the date — a "new source arrived" trigger could
 * not move the output, and re-running on an unchanged hash would just resample a
 * constant at temperature 0.
 *
 * The roster signature is folded in so that adding or dropping a member forces a
 * fresh sweep, rather than producing runs with different member sets under one hash.
 */
export function computeInputHash(
  prediction: PanelPrediction,
  now: Date,
  promptVersion: string,
  roster: readonly PanelMember[] = PANEL_MEMBERS,
): string {
  return createHash('sha256')
    .update(
      // JSON.stringify, not join(sep): with any plain separator, a claim ending in
      // "x" plus rules "y" hashes identically to claim "x y" plus empty rules. Such a
      // collision would make the sweep silently skip a forecast whose text changed.
      // Field boundaries must not be forgeable from user-authored claim text.
      JSON.stringify([
        prediction.claimText,
        prediction.resolutionRules ?? '',
        prediction.resolveByDatetime.toISOString(),
        utcDay(now),
        promptVersion,
        rosterSignature(roster),
      ]),
    )
    .digest('hex')
}

export function buildPanelPrompt(
  template: string,
  prediction: PanelPrediction,
  now: Date,
): string {
  return fillPrompt(template, {
    claimText: prediction.claimText,
    resolutionRules: prediction.resolutionRules ?? '(none specified)',
    resolveByDate: prediction.resolveByDatetime.toISOString().slice(0, 10),
    todayDate: utcDay(now),
    daysRemaining: daysRemaining(prediction.resolveByDatetime, now),
  })
}

interface MemberOutcome {
  member: PanelMember
  probability: number | null
  insufficientData: boolean
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number | null
  /** True when the call threw, as opposed to the model deliberately returning null. */
  failed: boolean
}

/**
 * Mutable state threaded through one sweep.
 *
 * `openRouterDisabled` latches on the first 401/403 and is honoured for every later
 * forecast, so a dead key costs exactly one rejected request per sweep instead of one
 * per member per forecast (285, on 2026-07-10). Bedrock members authenticate with the
 * app's IAM role and keep running regardless — that is the point of having one.
 */
export interface SweepContext {
  openRouterDisabled: boolean
  sawOpenRouterAuthError: boolean
}

/**
 * The panel can ask nobody: no OpenRouter key AND no member on a route that
 * authenticates some other way. A missing OpenRouter key alone is no longer dormancy —
 * Bedrock members use the app's IAM role.
 */
export function isDormant(apiKey: string, members: readonly PanelMember[]): boolean {
  if (apiKey) return false
  return !members.some((m) => m.route !== 'openrouter')
}

async function callMembers(
  members: readonly PanelMember[],
  prompt: string,
  apiKey: string,
  predictionId: string,
  ctx: SweepContext,
): Promise<MemberOutcome[]> {
  const outcomes: MemberOutcome[] = []
  // Members we cannot authenticate are not asked at all. We deliberately do NOT record
  // them as abstentions: an abstention means "the model saw the claim and declined",
  // and writing one for a member we never consulted would be a lie in the data.
  const queue = members.filter((m) => !(m.route === 'openrouter' && ctx.openRouterDisabled))

  const worker = async (): Promise<void> => {
    for (let member = queue.shift(); member; member = queue.shift()) {
      if (member.route === 'openrouter' && ctx.openRouterDisabled) continue
      try {
        const result = await callPanelMember(member, prompt, apiKey)
        outcomes.push({
          member,
          probability: result.probability,
          // A null probability is the model abstaining: the claim is too vague.
          insufficientData: result.probability === null,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          latencyMs: result.latencyMs,
          failed: false,
        })
      } catch (err) {
        if (err instanceof PanelAuthError) {
          // Latches for the rest of the sweep. Only OpenRouter members are affected;
          // Bedrock members keep going on the app's IAM role.
          ctx.openRouterDisabled = true
          ctx.sawOpenRouterAuthError = true
          log.error({ err }, 'OpenRouter rejected the API key — disabling those members')
          continue
        }
        logMemberFailure(member.model, predictionId, err)
        // A failure is an ABSTENTION, never a substitution. We do not retry with a
        // different model: an `AiEstimate` row must always contain output from the
        // model it names, or per-member Brier is meaningless.
        outcomes.push({
          member,
          probability: null,
          insufficientData: true,
          promptTokens: null,
          completionTokens: null,
          latencyMs: null,
          failed: true,
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MEMBER_CONCURRENCY, Math.max(queue.length, 1)) }, worker),
  )

  return outcomes
}

/**
 * Run one panel sweep over one forecast, unless the date-gate says nothing changed.
 *
 * Never writes `Prediction.confidence` / `aiCiLow` / `aiCiHigh`, and never calls
 * `recordEstimate()`. See docs/LASSO.md §1 — that isolation is the feature.
 */
export async function runPanelForPrediction(
  prediction: PanelPrediction,
  opts: {
    now?: Date
    dryRun?: boolean
    apiKey: string
    template?: string
    /** Shared across the sweep so a rejected OpenRouter key latches once, not per forecast. */
    ctx?: SweepContext
  },
): Promise<PanelRunResult> {
  const now = opts.now ?? new Date()
  // The sweep resolves the template once and threads it through. Fetching per
  // forecast would (a) hit SSM once per forecast — and when the parameter is absent,
  // `getPromptTemplate` returns the fallback WITHOUT caching, so nothing absorbs the
  // repeat — and (b) let a mid-sweep Bedrock prompt edit give forecasts in the same
  // sweep different promptVersions, which silently splits one member into two.
  const template = opts.template ?? (await getPromptTemplate('panel-estimate'))
  const promptVersion = promptVersionOf(template)
  const inputHash = computeInputHash(prediction, now, promptVersion)
  const ctx = opts.ctx ?? { openRouterDisabled: !opts.apiKey, sawOpenRouterAuthError: false }

  const latestRun = await prisma.aiEstimateRun.findFirst({
    where: { predictionId: prediction.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, inputHash: true, estimates: { select: { model: true, mode: true } } },
  })

  if (latestRun?.inputHash === inputHash) {
    // Completion pass. A run written while some members couldn't be authenticated (a
    // dead OpenRouter key latching mid-sweep) carries the day's hash but not the full
    // roster — those members were never asked, so no row exists for them. Skipping
    // outright would leave that hole unfillable until the next UTC day even after the
    // key is fixed, and every commitment pinning the run permanently unscoreable for
    // the missing members. Instead, ask ONLY the members that are missing AND askable
    // now, and append their estimates to the day's run.
    //
    // Appending is sound because the estimate is deterministic for the day: temperature
    // 0 and a date-only prompt mean the number is exactly what it would have been at the
    // run's original instant — the same premise the chart's step-function carry-forward
    // rests on. Members that already have a row (including failure-abstentions) are
    // never re-asked: one call per member per forecast per day stands.
    const recorded = new Set(latestRun.estimates.map((e) => `${e.model}:${e.mode}`))
    const missing = PANEL_MEMBERS.filter((m) => !recorded.has(`${m.model}:${m.mode}`))
    // Members we still cannot authenticate stay quiet: a deliberate Bedrock-only mode
    // (no OpenRouter key) must keep reporting skipped, not failed, on the second tick.
    const askable = missing.filter((m) => !(m.route === 'openrouter' && ctx.openRouterDisabled))

    if (askable.length === 0) {
      return { predictionId: prediction.id, status: 'skipped-unchanged', estimated: 0, abstained: 0 }
    }

    const prompt = buildPanelPrompt(template, prediction, now)

    if (opts.dryRun) {
      log.info(
        { predictionId: prediction.id, promptVersion, missing: askable.map((m) => m.model), prompt },
        'Panel dry run (would complete a partial run)',
      )
      return { predictionId: prediction.id, status: 'dry-run', estimated: 0, abstained: 0 }
    }

    const outcomes = await callMembers(askable, prompt, opts.apiKey, prediction.id, ctx)

    // Same rule as a fresh run: if nobody was reachable, write nothing so the next
    // tick (or the next key fix) can still retry today.
    if (outcomes.length === 0 || outcomes.every((o) => o.failed)) {
      log.error({ predictionId: prediction.id }, 'No missing panel member produced a result — appending nothing')
      return { predictionId: prediction.id, status: 'failed', estimated: 0, abstained: outcomes.length }
    }

    // skipDuplicates: a concurrent completion pass appending the same members is a
    // no-op, mirroring the P2002 handling on run creation.
    await prisma.aiEstimate.createMany({
      data: outcomes.map((o) => ({
        runId: latestRun.id,
        model: o.member.model,
        mode: o.member.mode,
        promptVersion,
        probability: o.probability,
        insufficientData: o.insufficientData,
        promptTokens: o.promptTokens,
        completionTokens: o.completionTokens,
        latencyMs: o.latencyMs,
      })),
      skipDuplicates: true,
    })

    const estimated = outcomes.filter((o) => o.probability !== null).length
    log.info(
      { predictionId: prediction.id, appended: outcomes.length, estimated },
      'Completed a partial panel run',
    )
    return {
      predictionId: prediction.id,
      status: 'completed-partial',
      estimated,
      abstained: outcomes.length - estimated,
    }
  }

  const prompt = buildPanelPrompt(template, prediction, now)

  if (opts.dryRun) {
    log.info({ predictionId: prediction.id, promptVersion, prompt }, 'Panel dry run')
    return { predictionId: prediction.id, status: 'dry-run', estimated: 0, abstained: 0 }
  }

  const outcomes = await callMembers(PANEL_MEMBERS, prompt, opts.apiKey, prediction.id, ctx)

  // No outcomes at all means every member was unauthenticated (no key, no IAM) — we
  // asked nobody. Same treatment as everybody failing: write nothing, retry next tick.
  //
  // And if every member's call THREW, that is our problem, not the models' — a dead
  // network, a bad credential. Writing a run of all-abstentions would let the date-gate
  // suppress any retry until tomorrow. (A run where members deliberately returned null
  // IS written: that is real signal about a vague claim.)
  if (outcomes.length === 0 || outcomes.every((o) => o.failed)) {
    log.error({ predictionId: prediction.id }, 'No panel member produced a result — writing nothing')
    return {
      predictionId: prediction.id,
      status: 'failed',
      estimated: 0,
      abstained: outcomes.length,
    }
  }

  const estimated = outcomes.filter((o) => o.probability !== null).length

  try {
    await prisma.aiEstimateRun.create({
      data: {
        predictionId: prediction.id,
        inputHash,
        estimates: {
          create: outcomes.map((o) => ({
            model: o.member.model,
            mode: o.member.mode,
            promptVersion,
            probability: o.probability,
            insufficientData: o.insufficientData,
            promptTokens: o.promptTokens,
            completionTokens: o.completionTokens,
            latencyMs: o.latencyMs,
          })),
        },
      },
    })
  } catch (err) {
    // Unique (predictionId, inputHash): a concurrent sweep beat us to it. Idempotent
    // by construction, so this is a no-op rather than an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        predictionId: prediction.id,
        status: 'skipped-duplicate',
        estimated: 0,
        abstained: 0,
      }
    }
    throw err
  }

  return {
    predictionId: prediction.id,
    status: 'written',
    estimated,
    abstained: outcomes.length - estimated,
  }
}

export interface PanelSweepSummary {
  considered: number
  /** Runs actually persisted. Always 0 on a dry run — see `dryRun` below. */
  written: number
  /** Partial runs (members missing because they couldn't be authenticated at write
   *  time) whose missing members' estimates were appended in place this sweep. */
  completedPartial: number
  skipped: number
  failed: number
  /** Forecasts whose prompt was built and logged but NOT persisted (`?dryRun=1`).
   *  Counted separately from `written`: a dry run reporting "written: 57" is exactly
   *  the output that makes someone trust a dry run they shouldn't. */
  dryRun: number
  /** The OpenRouter key was rejected (401/403). Those members were disabled for the
   *  rest of the sweep after the first rejection, rather than re-proving it once per
   *  member per forecast. Bedrock members carried on. The cron still surfaces this as a
   *  non-2xx so the scheduled workflow goes red — a dead key must not report
   *  "✅ Panel sweep OK" with the failures buried in JSON, even if other routes worked. */
  unauthorized?: boolean
  /** No member could be authenticated at all: no OpenRouter key AND no Bedrock member.
   *  A deliberate state, not a breakage — the cron answers 200. */
  dormant?: boolean
}

/**
 * Sweep every open forecast the panel can estimate.
 *
 * BINARY only: a single 0–100 is meaningless for MULTIPLE_CHOICE / NUMERIC_THRESHOLD.
 *
 * Deliberately NOT gated on "has at least one commitment". That gate would save a few
 * dollars, but matched-time Brier snapshots the run current at commit time — so a
 * forecast whose first commit arrives before its first run yields a null
 * `aiRunIdAtCommit` and is permanently unscoreable. The runs must lead the commits.
 */
export async function runPanelSweep(opts?: {
  now?: Date
  dryRun?: boolean
  limit?: number
}): Promise<PanelSweepSummary> {
  // Refresh (cached 5 min) so a key rotated with `put-parameter --overwrite` is picked up
  // by the next sweep without a redeploy — the whole point of moving it out of the blob.
  await warmAwsSecrets()
  const apiKey = getOpenRouterKey()

  if (isDormant(apiKey, PANEL_MEMBERS)) {
    log.warn('No OpenRouter key and no Bedrock member — AI panel is dormant')
    return { considered: 0, written: 0, completedPartial: 0, skipped: 0, failed: 0, dryRun: 0, dormant: true }
  }
  if (!apiKey) {
    log.warn('No OpenRouter key configured — running Bedrock members only')
  }

  const ctx: SweepContext = {
    openRouterDisabled: !apiKey,
    sawOpenRouterAuthError: false,
  }

  const now = opts?.now ?? new Date()

  // Resolved once, so every forecast in this sweep shares one promptVersion.
  const template = await getPromptTemplate('panel-estimate')

  const predictions = await prisma.prediction.findMany({
    where: {
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: { gt: now },
    },
    select: { id: true, claimText: true, resolutionRules: true, resolveByDatetime: true },
    orderBy: { createdAt: 'desc' },
    ...(opts?.limit ? { take: opts.limit } : {}),
  })

  const summary: PanelSweepSummary = {
    considered: predictions.length,
    written: 0,
    completedPartial: 0,
    skipped: 0,
    failed: 0,
    dryRun: 0,
  }

  for (const prediction of predictions) {
    try {
      const result = await runPanelForPrediction(prediction, {
        now,
        dryRun: opts?.dryRun,
        apiKey,
        template,
        ctx,
      })
      if (result.status === 'written') summary.written += 1
      else if (result.status === 'completed-partial') summary.completedPartial += 1
      else if (result.status === 'dry-run') summary.dryRun += 1
      else if (result.status === 'failed') summary.failed += 1
      else summary.skipped += 1
    } catch (err) {
      // One bad forecast must not abort the sweep.
      log.error({ err, predictionId: prediction.id }, 'Panel run threw')
      summary.failed += 1
    }
  }

  // Reported even when Bedrock members carried the sweep: a dead OpenRouter key is an
  // incident to fix, not a state to tolerate, and the route turns this into a 502 so
  // the scheduled workflow goes red.
  if (ctx.sawOpenRouterAuthError) summary.unauthorized = true

  log.info(summary, 'AI panel sweep complete')
  return summary
}
