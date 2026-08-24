import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createLatentNode, mergeLatentNode, promoteLatentNode, UnresolvableLatentNodeError, getOrCreateOracle2SystemUser } from '../latent-node'

async function makeUserAndPrediction(claimText: string) {
  const user = await prisma.user.create({
    data: { email: `${claimText.replace(/\s+/g, '-')}-${Date.now()}@example.com`, name: 'Test User', rs: 100 },
  })
  const prediction = await prisma.prediction.create({
    data: {
      claimText,
      authorId: user.id,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `token-${claimText}-${Date.now()}-${Math.random()}`,
    },
  })
  return prediction
}

describe('LatentNode service integration', () => {
  it('creates a latent node with the given classifier fields and OPEN status', async () => {
    const node = await createLatentNode({
      textEn: 'Israel withdraws from southern Lebanon',
      claimDirection: 'ARRIVAL',
      claimArchetype: 'SCHEDULED',
      origin: 'MCP_PROBE',
    })
    expect(node.status).toBe('OPEN')
    expect(node.claimDirection).toBe('ARRIVAL')
    expect(node.fanIn).toBe(0)
  })

  it('repoints a relation from the merged source onto the target', async () => {
    const pred = await makeUserAndPrediction('IDF maintains presence in Lebanon')
    const source = await createLatentNode({ textEn: 'source clause', origin: 'MCP_PROBE' })
    const target = await createLatentNode({ textEn: 'target clause', origin: 'MCP_PROBE' })

    const rel = await prisma.questionRelation.create({
      data: { fromLatentNodeId: source.id, toPredictionId: pred.id, kind: 'IMPLIES', createdBy: 'MODEL' },
    })

    const outcome = await mergeLatentNode(source.id, target.id, 'admin-user')
    expect(outcome).toEqual({ merged: source.id, into: target.id, relationsRepointed: 1, relationsDropped: 0 })

    const updated = await prisma.questionRelation.findUniqueOrThrow({ where: { id: rel.id } })
    expect(updated.fromLatentNodeId).toBe(target.id)
    expect(updated.fromPredictionId).toBeNull()

    const mergedSource = await prisma.latentNode.findUniqueOrThrow({ where: { id: source.id } })
    expect(mergedSource.status).toBe('MERGED')
    expect(mergedSource.mergedIntoId).toBe(target.id)
  })

  it('drops a repointed relation that would duplicate one the target already has', async () => {
    const pred = await makeUserAndPrediction('forms government')
    const source = await createLatentNode({ textEn: 'source clause', origin: 'MCP_PROBE' })
    const target = await createLatentNode({ textEn: 'target clause', origin: 'MCP_PROBE' })

    await prisma.questionRelation.create({
      data: { fromLatentNodeId: target.id, toPredictionId: pred.id, kind: 'IMPLIES', createdBy: 'MODEL' },
    })
    const sourceRel = await prisma.questionRelation.create({
      data: { fromLatentNodeId: source.id, toPredictionId: pred.id, kind: 'IMPLIES', createdBy: 'MODEL' },
    })

    const outcome = await mergeLatentNode(source.id, target.id, 'admin-user')
    expect(outcome).toEqual({ merged: source.id, into: target.id, relationsRepointed: 0, relationsDropped: 1 })

    const gone = await prisma.questionRelation.findUnique({ where: { id: sourceRel.id } })
    expect(gone).toBeNull()
  })

  it('drops a symmetric-kind duplicate detected in the flipped orientation', async () => {
    const pred = await makeUserAndPrediction('Netanyahu remains PM')
    const source = await createLatentNode({ textEn: 'source clause', origin: 'MCP_PROBE' })
    const target = await createLatentNode({ textEn: 'target clause', origin: 'MCP_PROBE' })

    // Existing row: pred -> target (COMPLEMENT is symmetric).
    await prisma.questionRelation.create({
      data: { fromPredictionId: pred.id, toLatentNodeId: target.id, kind: 'COMPLEMENT', createdBy: 'MODEL' },
    })
    // Source's row is the opposite orientation: pred -> source.
    const sourceRel = await prisma.questionRelation.create({
      data: { fromPredictionId: pred.id, toLatentNodeId: source.id, kind: 'COMPLEMENT', createdBy: 'MODEL' },
    })

    const outcome = await mergeLatentNode(source.id, target.id, 'admin-user')
    expect(outcome.relationsDropped).toBe(1)
    expect(outcome.relationsRepointed).toBe(0)

    const gone = await prisma.questionRelation.findUnique({ where: { id: sourceRel.id } })
    expect(gone).toBeNull()
  })

  it('drops a relation directly between source and target instead of creating a self-loop', async () => {
    const source = await createLatentNode({ textEn: 'source clause', origin: 'MCP_PROBE' })
    const target = await createLatentNode({ textEn: 'target clause', origin: 'MCP_PROBE' })

    const rel = await prisma.questionRelation.create({
      data: { fromLatentNodeId: source.id, toLatentNodeId: target.id, kind: 'ALIAS', createdBy: 'MODEL' },
    })

    const outcome = await mergeLatentNode(source.id, target.id, 'admin-user')
    expect(outcome).toEqual({ merged: source.id, into: target.id, relationsRepointed: 0, relationsDropped: 1 })

    const gone = await prisma.questionRelation.findUnique({ where: { id: rel.id } })
    expect(gone).toBeNull()
  })

  it('rejects merging a non-OPEN source', async () => {
    const source = await createLatentNode({ textEn: 'source clause', origin: 'MCP_PROBE' })
    const target = await createLatentNode({ textEn: 'target clause', origin: 'MCP_PROBE' })
    await prisma.latentNode.update({ where: { id: source.id }, data: { status: 'REJECTED' } })

    await expect(mergeLatentNode(source.id, target.id, 'admin-user')).rejects.toThrow(/not OPEN/)
  })

  it('rejects merging into an already-merged target', async () => {
    const a = await createLatentNode({ textEn: 'a', origin: 'MCP_PROBE' })
    const b = await createLatentNode({ textEn: 'b', origin: 'MCP_PROBE' })
    const c = await createLatentNode({ textEn: 'c', origin: 'MCP_PROBE' })
    await mergeLatentNode(a.id, b.id, 'admin-user')

    await expect(mergeLatentNode(c.id, a.id, 'admin-user')).rejects.toThrow(/itself merged/)
  })

  it('rejects self-merge', async () => {
    const node = await createLatentNode({ textEn: 'a', origin: 'MCP_PROBE' })
    await expect(mergeLatentNode(node.id, node.id, 'admin-user')).rejects.toThrow(/itself/)
  })
})

describe('LatentNode promotion', () => {
  it('promotes a standalone OPEN node with its own classifier fields into a DRAFT Prediction', async () => {
    const node = await createLatentNode({
      textEn: 'Israel withdraws from southern Lebanon',
      claimDeadline: new Date('2030-06-01'),
      claimDirection: 'ARRIVAL',
      claimArchetype: 'SCHEDULED',
      origin: 'MCP_PROBE',
    })

    const prediction = await promoteLatentNode(node.id, 'admin-user')
    expect(prediction.status).toBe('DRAFT')
    expect(prediction.claimText).toBe(node.textEn)

    const updated = await prisma.latentNode.findUniqueOrThrow({ where: { id: node.id } })
    expect(updated.status).toBe('PROMOTED')
    expect(updated.predictionId).toBe(prediction.id)
  })

  it('attributes promoted predictions to the shared oracle2 system user, not a BotConfig-backed persona', async () => {
    const node = await createLatentNode({
      textEn: 'a distinct promotable clause',
      claimDeadline: new Date('2030-06-01'),
      claimDirection: 'ARRIVAL',
      claimArchetype: 'SCHEDULED',
      origin: 'MCP_PROBE',
    })
    const prediction = await promoteLatentNode(node.id, 'admin-user')
    const author = await getOrCreateOracle2SystemUser()
    expect(prediction.authorId).toBe(author.id)

    const botConfig = await prisma.botConfig.findUnique({ where: { userId: author.id } })
    expect(botConfig).toBeNull()
  })

  it('rejects promoting a node that has not cleared the resolvability gate', async () => {
    const node = await createLatentNode({ textEn: 'no classifier fields at all', origin: 'MCP_PROBE' })
    await expect(promoteLatentNode(node.id, 'admin-user')).rejects.toThrow(UnresolvableLatentNodeError)
  })

  it('rejects promoting a non-OPEN node', async () => {
    const node = await createLatentNode({
      textEn: 'already merged',
      claimDeadline: new Date('2030-06-01'),
      claimDirection: 'ARRIVAL',
      claimArchetype: 'SCHEDULED',
      origin: 'MCP_PROBE',
    })
    await prisma.latentNode.update({ where: { id: node.id }, data: { status: 'REJECTED' } })
    await expect(promoteLatentNode(node.id, 'admin-user')).rejects.toThrow(/not OPEN/)
  })

  it('derives missing fields from the parent Prediction for a VARIANT node and repoints the relation', async () => {
    const pred = await makeUserAndPrediction('Netanyahu remains PM through 2027')
    await prisma.prediction.update({
      where: { id: pred.id },
      data: { claimDeadline: new Date('2030-01-01'), claimDirection: 'ARRIVAL', claimArchetype: 'SCHEDULED' },
    })

    const variant = await createLatentNode({ textEn: 'Netanyahu does not remain PM through 2027', origin: 'VARIANT' })
    const relation = await prisma.questionRelation.create({
      data: { fromPredictionId: pred.id, toLatentNodeId: variant.id, kind: 'COMPLEMENT', createdBy: 'DERIVED' },
    })
    await prisma.latentNode.update({ where: { id: variant.id }, data: { variantOfRelationId: relation.id } })

    // The derived deadline (parent's claimDeadline, COMPLEMENT flips direction but not
    // deadline) becomes resolveByDatetime — createForecast's required field.
    // claimDeadline/claimDirection on the new row are independently (re-)classified
    // async by createForecast's own fire-and-forget classifyAndStoreTemporal call, so
    // they aren't asserted here (known funnel gap, see forecast.ts's comment on it).
    const promoted = await promoteLatentNode(variant.id, 'admin-user')
    expect(promoted.resolveByDatetime.toISOString()).toBe(new Date('2030-01-01').toISOString())

    const updatedRelation = await prisma.questionRelation.findUniqueOrThrow({ where: { id: relation.id } })
    expect(updatedRelation.fromPredictionId).toBe(pred.id)
    expect(updatedRelation.toPredictionId).toBe(promoted.id)
    expect(updatedRelation.toLatentNodeId).toBeNull()
  })

  it('repoints correctly when the latent node sits on the `to` side of its variant relation', async () => {
    const pred = await makeUserAndPrediction('forms next coalition')
    await prisma.prediction.update({
      where: { id: pred.id },
      data: { claimDeadline: new Date('2030-01-01'), claimDirection: 'ARRIVAL', claimArchetype: 'SCHEDULED' },
    })

    const variant = await createLatentNode({ textEn: 'reworded coalition clause', origin: 'VARIANT' })
    const relation = await prisma.questionRelation.create({
      data: { toPredictionId: pred.id, fromLatentNodeId: variant.id, kind: 'ALIAS', createdBy: 'DERIVED' },
    })
    await prisma.latentNode.update({ where: { id: variant.id }, data: { variantOfRelationId: relation.id } })

    const promoted = await promoteLatentNode(variant.id, 'admin-user')
    const updatedRelation = await prisma.questionRelation.findUniqueOrThrow({ where: { id: relation.id } })
    expect(updatedRelation.fromPredictionId).toBe(promoted.id)
    expect(updatedRelation.fromLatentNodeId).toBeNull()
    expect(updatedRelation.toPredictionId).toBe(pred.id)
  })

  it('rejects promoting a VARIANT node whose relation has no Prediction endpoint (data invariant check)', async () => {
    const a = await createLatentNode({ textEn: 'latent a', origin: 'VARIANT' })
    const b = await createLatentNode({ textEn: 'latent b', origin: 'MCP_PROBE' })
    const relation = await prisma.questionRelation.create({
      data: { fromLatentNodeId: a.id, toLatentNodeId: b.id, kind: 'ALIAS', createdBy: 'MODEL' },
    })
    await prisma.latentNode.update({ where: { id: a.id }, data: { variantOfRelationId: relation.id } })

    await expect(promoteLatentNode(a.id, 'admin-user')).rejects.toThrow(/data invariant violated/)
  })
})

describe('question_relations polymorphic endpoint constraints', () => {
  it('rejects a row with both a prediction and a latent-node endpoint on the same side', async () => {
    const pred = await makeUserAndPrediction('some claim')
    const node = await createLatentNode({ textEn: 'clause', origin: 'MCP_PROBE' })
    await expect(
      prisma.questionRelation.create({
        data: {
          fromPredictionId: pred.id,
          fromLatentNodeId: node.id,
          toPredictionId: pred.id,
          kind: 'ALIAS',
          createdBy: 'MODEL',
        },
      }),
    ).rejects.toThrow()
  })

  it('rejects a row with neither endpoint set on one side', async () => {
    const pred = await makeUserAndPrediction('some other claim')
    await expect(
      prisma.questionRelation.create({
        data: { toPredictionId: pred.id, kind: 'ALIAS', createdBy: 'MODEL' },
      }),
    ).rejects.toThrow()
  })

  it('still enforces the original prediction-prediction unique constraint (M1, unchanged)', async () => {
    const a = await makeUserAndPrediction('claim a')
    const b = await makeUserAndPrediction('claim b')
    await prisma.questionRelation.create({
      data: { fromPredictionId: a.id, toPredictionId: b.id, kind: 'IMPLIES', createdBy: 'MODEL' },
    })
    await expect(
      prisma.questionRelation.create({
        data: { fromPredictionId: a.id, toPredictionId: b.id, kind: 'IMPLIES', createdBy: 'MODEL' },
      }),
    ).rejects.toThrow()
  })
})
