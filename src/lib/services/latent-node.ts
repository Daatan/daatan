/**
 * Latent nodes — Oracle 2.0 storage layer M2 (daatan#1556).
 *
 * A `LatentNode` is a "shadow forecast": a question that exists and is priced
 * but that no one has published. This module covers creation and merge only.
 * No promotion path yet — `predictionId`/`PROMOTED` are on the schema for the
 * shape but nothing sets them. The linking pipeline that would normally
 * create these rows from article extraction (v2 steps 2–4) doesn't exist yet
 * either — `createLatentNode` here is a minimal admin-facing stand-in so
 * merge has real rows to operate on.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { embedAndStoreLatentNode } from './embedding'
import { SYMMETRIC_KINDS } from './question-relation'
import type {
  ClaimArchetype,
  ClaimDirection,
  LatentNode,
  LatentNodeOrigin,
  LatentNodeStatus,
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
