/**
 * Latent nodes — Oracle 2.0 storage layer M2 (daatan#1556) + promotion (daatan#1602).
 *
 * A `LatentNode` is a "shadow forecast": a question that exists and is priced
 * but that no one has published. This module covers creation, merge, and
 * promotion. The linking pipeline that would normally create these rows from
 * article extraction (v2 steps 2–4) doesn't exist yet — `createLatentNode`
 * here is a minimal admin-facing stand-in so merge/promote have real rows to
 * operate on.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { embedAndStoreLatentNode } from './embedding'
import { SYMMETRIC_KINDS } from './question-relation'
import { createForecast } from './forecast'
import type {
  ClaimArchetype,
  ClaimDirection,
  LatentNode,
  LatentNodeOrigin,
  LatentNodeStatus,
  Prediction,
  QuestionRelation,
  QuestionRelationKind,
} from '@prisma/client'

const log = createLogger('latent-node')

export interface CreateLatentNodeInput {
  textEn: string
  claimDeadline?: Date | null
  claimDirection?: ClaimDirection | null
  claimArchetype?: ClaimArchetype | null
  origin: LatentNodeOrigin
  createdBy?: string | null
}

export async function createLatentNode(input: CreateLatentNodeInput): Promise<LatentNode> {
  const node = await prisma.latentNode.create({
    data: {
      textEn: input.textEn,
      claimDeadline: input.claimDeadline ?? null,
      claimDirection: input.claimDirection ?? null,
      claimArchetype: input.claimArchetype ?? null,
      origin: input.origin,
      createdBy: input.createdBy ?? null,
    },
  })
  // Fire-and-forget, same contract as forecast creation (embedding.ts):
  // the row exists whether or not the embedding call succeeds.
  embedAndStoreLatentNode(node.id, node.textEn).catch((err) => log.error({ err, id: node.id }, 'embed failed'))
  return node
}

export async function listLatentNodes(opts: { status?: LatentNodeStatus; limit?: number } = {}): Promise<LatentNode[]> {
  return prisma.latentNode.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
  })
}

interface Endpoint {
  predictionId: string | null
  latentNodeId: string | null
}

function endpointOf(
  rel: { fromPredictionId: string | null; fromLatentNodeId: string | null; toPredictionId: string | null; toLatentNodeId: string | null },
  side: 'from' | 'to',
): Endpoint {
  return side === 'from'
    ? { predictionId: rel.fromPredictionId, latentNodeId: rel.fromLatentNodeId }
    : { predictionId: rel.toPredictionId, latentNodeId: rel.toLatentNodeId }
}

function pairWhere(from: Endpoint, to: Endpoint, kind: QuestionRelationKind) {
  return {
    fromPredictionId: from.predictionId,
    fromLatentNodeId: from.latentNodeId,
    toPredictionId: to.predictionId,
    toLatentNodeId: to.latentNodeId,
    kind,
  }
}

export interface MergeOutcome {
  merged: string
  into: string
  relationsRepointed: number
  relationsDropped: number
}

/**
 * Merge `sourceId` into `targetId`: marks the source MERGED, and repoints
 * every question_relations row touching it onto the target. A row that would
 * duplicate one already pointing at the target (checked both orientations for
 * symmetric kinds — see SYMMETRIC_KINDS) is dropped instead of repointed,
 * since it's now redundant. A row that directly related source to target
 * (typically the ALIAS that justified the merge) is also dropped — after the
 * merge it would be a self-loop.
 */
export async function mergeLatentNode(sourceId: string, targetId: string, decidedBy: string): Promise<MergeOutcome> {
  if (sourceId === targetId) throw new Error('Cannot merge a latent node into itself')

  const outcome = await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.latentNode.findUniqueOrThrow({ where: { id: sourceId } }),
      tx.latentNode.findUniqueOrThrow({ where: { id: targetId } }),
    ])
    if (source.status !== 'OPEN') {
      throw new Error(`Source latent node ${sourceId} is not OPEN (status: ${source.status})`)
    }
    if (target.status === 'MERGED') {
      throw new Error(`Target latent node ${targetId} is itself merged — merge into its root instead`)
    }

    const touching = await tx.questionRelation.findMany({
      where: { OR: [{ fromLatentNodeId: sourceId }, { toLatentNodeId: sourceId }] },
    })

    let relationsRepointed = 0
    let relationsDropped = 0

    for (const rel of touching) {
      const fromIsSource = rel.fromLatentNodeId === sourceId
      const targetEndpoint: Endpoint = { predictionId: null, latentNodeId: targetId }
      const otherEndpoint = fromIsSource ? endpointOf(rel, 'to') : endpointOf(rel, 'from')

      // The relation directly related source to target (e.g. the ALIAS that
      // justified this merge) — after repointing it would be a self-loop.
      if (otherEndpoint.latentNodeId === targetId) {
        await tx.questionRelation.delete({ where: { id: rel.id } })
        relationsDropped++
        continue
      }

      const newFrom = fromIsSource ? targetEndpoint : otherEndpoint
      const newTo = fromIsSource ? otherEndpoint : targetEndpoint

      const duplicateWheres = [pairWhere(newFrom, newTo, rel.kind)]
      if (SYMMETRIC_KINDS.has(rel.kind)) duplicateWheres.push(pairWhere(newTo, newFrom, rel.kind))

      const duplicate = await tx.questionRelation.findFirst({
        where: { id: { not: rel.id }, OR: duplicateWheres },
      })

      if (duplicate) {
        await tx.questionRelation.delete({ where: { id: rel.id } })
        relationsDropped++
      } else {
        await tx.questionRelation.update({
          where: { id: rel.id },
          data: {
            fromPredictionId: newFrom.predictionId,
            fromLatentNodeId: newFrom.latentNodeId,
            toPredictionId: newTo.predictionId,
            toLatentNodeId: newTo.latentNodeId,
          },
        })
        relationsRepointed++
      }
    }

    await tx.latentNode.update({ where: { id: sourceId }, data: { status: 'MERGED', mergedIntoId: targetId } })

    return { merged: sourceId, into: targetId, relationsRepointed, relationsDropped }
  })

  log.info({ ...outcome, decidedBy }, 'latent node merged')
  return outcome
}

// ── Promotion (daatan#1602) ─────────────────────────────────────────────────

const ORACLE2_SYSTEM_USERNAME = 'oracle2_system'
const ORACLE2_SYSTEM_EMAIL = `${ORACLE2_SYSTEM_USERNAME}@daatan.internal`

/**
 * The author of record for every promoted latent node. Deliberately a plain
 * `User` with `isBot: true` and NO `BotConfig` row — a `BotConfig` carries
 * RSS sources / persona prompts / a scheduler interval, and `runDueBots()`
 * (bots/runner.ts) iterates `botConfig.findMany`, so giving this identity a
 * BotConfig would make the 5-minute bot cron try to run it. This account only
 * needs to exist as an attribution target, never to act.
 */
export async function getOrCreateOracle2SystemUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: ORACLE2_SYSTEM_EMAIL }, select: { id: true } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      email: ORACLE2_SYSTEM_EMAIL,
      name: 'Oracle 2.0',
      username: ORACLE2_SYSTEM_USERNAME,
      slug: ORACLE2_SYSTEM_USERNAME,
      isBot: true,
      emailNotifications: false,
      isPublic: true,
    },
    select: { id: true },
  })
}

/** COMPLEMENT flips the underlying event (P(from)+P(to)=1); ALIAS/NESTED_DEADLINE keep it. */
function flipDirectionForComplement(direction: ClaimDirection): ClaimDirection {
  if (direction === 'ARRIVAL') return 'SURVIVAL'
  if (direction === 'SURVIVAL') return 'ARRIVAL'
  return direction
}

interface DerivedFields {
  claimDeadline: Date | null
  claimDirection: ClaimDirection | null
  claimArchetype: ClaimArchetype | null
}

/**
 * A VARIANT node is always a variant *of an existing forecast* (origin enum
 * comment) — its `variantOfRelationId` row's other endpoint is guaranteed to
 * already be a real `Prediction`, never another latent node. When the node's
 * own classifier fields are null, derive them from that parent rather than
 * blocking promotion on fields the linking pipeline doesn't populate yet:
 * complement flips direction and keeps the parent's deadline; alias keeps
 * both; nested_deadline keeps its own deadline if set, else falls back to
 * the parent's.
 */
async function deriveVariantFields(node: LatentNode, relation: QuestionRelation): Promise<DerivedFields> {
  const parentPredictionId = relation.fromLatentNodeId === node.id ? relation.toPredictionId : relation.fromPredictionId
  if (!parentPredictionId) {
    throw new Error(`Latent node ${node.id}'s variant relation ${relation.id} has no Prediction endpoint — data invariant violated`)
  }
  const parent = await prisma.prediction.findUniqueOrThrow({
    where: { id: parentPredictionId },
    select: { claimDeadline: true, claimDirection: true, claimArchetype: true },
  })

  const claimDirection =
    node.claimDirection ?? (relation.kind === 'COMPLEMENT' && parent.claimDirection ? flipDirectionForComplement(parent.claimDirection) : parent.claimDirection)

  return {
    claimDeadline: node.claimDeadline ?? parent.claimDeadline,
    claimDirection,
    claimArchetype: node.claimArchetype ?? parent.claimArchetype,
  }
}

export class UnresolvableLatentNodeError extends Error {}

/**
 * Promote an OPEN latent node into a real, published-eligible `Prediction`.
 * Reuses `createForecast` (the Express/manual-draft path) rather than
 * hand-rolling a second creation path — the new Prediction starts `DRAFT`
 * (createForecast's own default), same as the batch-created graph_pm
 * forecasts: promotion is the moderation act, publishing is a separate step.
 *
 * A VARIANT node's `variantOfRelationId` row gets repointed from the latent
 * endpoint onto the new Prediction, so the parent relationship survives as an
 * ordinary Prediction↔Prediction `question_relations` row instead of being
 * lost. If that would collide with a row the parent already has (mirrors the
 * duplicate check in `mergeLatentNode`), the now-redundant relation is
 * dropped instead of double-written.
 */
export async function promoteLatentNode(id: string, promotedBy: string): Promise<Prediction> {
  const node = await prisma.latentNode.findUniqueOrThrow({ where: { id } })
  if (node.status !== 'OPEN') {
    throw new Error(`Latent node ${id} is not OPEN (status: ${node.status})`)
  }

  let relation: QuestionRelation | null = null
  let fields: DerivedFields = { claimDeadline: node.claimDeadline, claimDirection: node.claimDirection, claimArchetype: node.claimArchetype }

  if (node.variantOfRelationId) {
    relation = await prisma.questionRelation.findUniqueOrThrow({ where: { id: node.variantOfRelationId } })
    fields = await deriveVariantFields(node, relation)
  }

  if (!fields.claimDeadline || !fields.claimDirection || !fields.claimArchetype) {
    throw new UnresolvableLatentNodeError(
      `Latent node ${id} has not cleared the resolvability gate (claimDeadline/claimDirection/claimArchetype must all be set${node.variantOfRelationId ? ', and could not be derived from its variant parent' : ''})`,
    )
  }

  const author = await getOrCreateOracle2SystemUser()

  const prediction = await createForecast({
    authorId: author.id,
    claimText: node.textEn,
    outcomeType: 'BINARY',
    resolveByDatetime: fields.claimDeadline.toISOString(),
  })
  if (!prediction) throw new Error(`createForecast returned no row promoting latent node ${id}`)

  await prisma.$transaction(async (tx) => {
    const current = await tx.latentNode.findUniqueOrThrow({ where: { id } })
    if (current.status !== 'OPEN') {
      throw new Error(`Latent node ${id} changed status to ${current.status} mid-promotion — aborting`)
    }
    await tx.latentNode.update({ where: { id }, data: { status: 'PROMOTED', predictionId: prediction.id } })

    if (relation) {
      // No duplicate check needed here (unlike mergeLatentNode's repoint): `prediction.id`
      // is brand new in this same operation, so no pre-existing relation could already
      // reference it — a collision is structurally impossible, not just unlikely.
      const fromIsNode = relation.fromLatentNodeId === id
      const otherPredictionId = fromIsNode ? relation.toPredictionId : relation.fromPredictionId
      if (!otherPredictionId) {
        throw new Error(`Latent node ${id}'s variant relation ${relation.id} has no Prediction endpoint — data invariant violated`)
      }
      await tx.questionRelation.update({
        where: { id: relation.id },
        data: {
          fromPredictionId: fromIsNode ? prediction.id : otherPredictionId,
          fromLatentNodeId: null,
          toPredictionId: fromIsNode ? otherPredictionId : prediction.id,
          toLatentNodeId: null,
        },
      })
    }
  })

  log.info({ latentNodeId: id, predictionId: prediction.id, promotedBy, variant: !!relation }, 'latent node promoted')
  return prediction
}
