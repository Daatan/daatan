import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { vertexEnv, vertexEndpoint, vertexAccessToken, type VertexEnv } from '@/lib/llm/providers/vertex'

const log = createLogger('embedding')

const EMBEDDING_MODEL = 'gemini-embedding-2'
const EMBEDDING_DIM = 768

/**
 * `embedContent` answers with a single `embedding` on the Developer API. Vertex
 * documents both singular and plural forms across its embedding surfaces, so read
 * either — the dimension check below is what actually guards the column.
 */
interface EmbedResponse {
  embedding?: { values?: number[] }
  embeddings?: Array<{ values?: number[] }>
}

function vectorFrom(data: EmbedResponse, source: string): number[] {
  const values = data.embedding?.values ?? data.embeddings?.[0]?.values
  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(
      `${source} returned ${values ? `${values.length} dimensions` : 'no embedding'}, expected ${EMBEDDING_DIM}`
    )
  }
  return values
}

/**
 * Vertex AI (daatan#1472) — same model, same body, but billed as an ordinary GCP
 * service instead of against the Developer API's prepaid balance.
 */
async function embedViaVertex(env: VertexEnv, text: string): Promise<number[]> {
  const token = await vertexAccessToken(env)
  const res = await fetch(vertexEndpoint(env, EMBEDDING_MODEL, 'embedContent'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // No `model` field: on Vertex the model is part of the URL, and the request is
    // otherwise identical to the Developer API's.
    body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIM }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vertex ${res.status}: ${body.slice(0, 300)}`)
  }
  return vectorFrom((await res.json()) as EmbedResponse, 'Vertex')
}

async function embedViaDeveloperApi(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    log.warn('GEMINI_API_KEY not set — skipping embedding')
    return null
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIM,
        }),
      }
    )
    if (!res.ok) {
      const body = await res.text()
      log.error({ status: res.status, body }, 'Gemini embedding API error')
      return null
    }
    return vectorFrom((await res.json()) as EmbedResponse, 'Gemini')
  } catch (err) {
    log.error({ err }, 'Failed to embed text')
    return null
  }
}

/**
 * Vertex when its service account is provisioned, the Developer API otherwise —
 * and also when Vertex fails, so a misconfigured SA degrades to today's behaviour
 * instead of leaving forecasts unembedded. That rescue is invisible to callers by
 * design, so the `vertex-embed-failed` log line below is the only signal that the
 * Vertex path is broken; it is what to grep for.
 *
 * Since #1472 Daatan's own SaaS containers no longer carry GEMINI_API_KEY, so in
 * production the rescue is inert: a Vertex failure now means the forecast goes
 * unembedded rather than being embedded by the other platform. That is deliberate
 * — the two platforms return bit-identical vectors for the same text (measured on
 * prod over 20 real claims, 2026-08-19), so the rescue was never a correctness
 * risk, but a silent second billing surface is worth more than it saves. The leg
 * stays for the self-host edition, which has no service account and no Vertex.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const env = vertexEnv()
  if (env) {
    try {
      return await embedViaVertex(env, text)
    } catch (err) {
      log.error({ err, event: 'vertex-embed-failed' }, 'Vertex embedding failed — falling back to the Developer API')
    }
  }
  return embedViaDeveloperApi(text)
}

const BATCH_SIZE = 100
const BATCH_CONCURRENCY = 4

async function embedBatchViaVertex(env: VertexEnv, texts: string[]): Promise<number[][]> {
  const token = await vertexAccessToken(env)
  const res = await fetch(vertexEndpoint(env, EMBEDDING_MODEL, 'batchEmbedContents'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(text => ({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIM })),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vertex batch ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> }
  const out = data.embeddings ?? []
  if (out.length !== texts.length) throw new Error(`Vertex batch returned ${out.length} embeddings for ${texts.length} texts`)
  return out.map(e => vectorFrom({ embedding: e }, 'Vertex batch'))
}

/**
 * Embed many texts, same vectors as {@link embedText} (checked 2026-11-17: cosine 1.00000
 * against single calls on 100 claims). Vertex `batchEmbedContents` takes 100 texts in ~4 s
 * where 100 single calls take ~70 s, which is what lets the retro generator (daatan#2217)
 * embed a week of pool claims inside one request. A failed batch, or no Vertex, falls back
 * to single calls for that batch; an entry stays null when its text could not be embedded.
 */
export async function embedTexts(texts: string[]): Promise<Array<number[] | null>> {
  const env = vertexEnv()
  const out: Array<number[] | null> = new Array(texts.length).fill(null)
  const starts: number[] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) starts.push(i)

  const runBatch = async (start: number) => {
    const chunk = texts.slice(start, start + BATCH_SIZE)
    if (env) {
      try {
        const vectors = await embedBatchViaVertex(env, chunk)
        vectors.forEach((v, k) => { out[start + k] = v })
        return
      } catch (err) {
        log.error({ err, event: 'vertex-embed-failed', batch: chunk.length }, 'Vertex batch embedding failed — falling back to single calls')
      }
    }
    for (let k = 0; k < chunk.length; k++) out[start + k] = await embedText(chunk[k])
  }

  for (let i = 0; i < starts.length; i += BATCH_CONCURRENCY) {
    await Promise.all(starts.slice(i, i + BATCH_CONCURRENCY).map(runBatch))
  }
  return out
}

/**
 * Embed `claimText` and write it to the prediction's vector column.
 *
 * **Throws when nothing was stored.** It used to `return` silently on both failure
 * modes, which made it impossible for a caller to tell a stored embedding from a
 * skipped one — and every caller counts: the cron and admin backfills both wrap
 * this in try/catch and increment `done`, so a silent skip was reported as a
 * success while the row stayed NULL. `POST /api/cron/backfill-embeddings` would
 * answer `{done: 20, failed: 0}` having written nothing at all.
 *
 * That went from unlikely to plausible with #1472: production no longer carries
 * `GEMINI_API_KEY`, so there is no Developer-API rescue behind Vertex. A Vertex
 * outage now means `embedText()` returns null on every call, and the nightly cron
 * would have reported a clean run indefinitely.
 *
 * Every existing caller already has a `.catch()` or a try/catch — the fire-and-
 * forget ones simply gain the error log they should always have had.
 */
export async function embedAndStoreForecast(id: string, claimText: string): Promise<void> {
  const embedding = await embedText(claimText)
  if (!embedding) {
    throw new Error(`No embedding returned for prediction ${id} — nothing stored`)
  }
  await storeForecastEmbedding(id, embedding)
}

/** Write an already-computed vector to the prediction's column, for a caller that embedded the claim itself. */
export async function storeForecastEmbedding(id: string, embedding: number[]): Promise<void> {
  if (!embedding.every(Number.isFinite)) {
    throw new Error(`Embedding for prediction ${id} contains non-finite values — nothing stored`)
  }
  const vectorStr = `[${embedding.join(',')}]`
  await prisma.$executeRaw(
    Prisma.sql`UPDATE predictions SET embedding = ${Prisma.raw(`'${vectorStr}'::vector`)} WHERE id = ${id}`
  )
}

/** Same contract as {@link embedAndStoreForecast}, targeting latent_nodes (daatan#1556). */
export async function embedAndStoreLatentNode(id: string, textEn: string): Promise<void> {
  const embedding = await embedText(textEn)
  if (!embedding) {
    throw new Error(`No embedding returned for latent node ${id} — nothing stored`)
  }
  if (!embedding.every(Number.isFinite)) {
    throw new Error(`Embedding for latent node ${id} contains non-finite values — nothing stored`)
  }
  const vectorStr = `[${embedding.join(',')}]`
  await prisma.$executeRaw(
    Prisma.sql`UPDATE latent_nodes SET embedding = ${Prisma.raw(`'${vectorStr}'::vector`)} WHERE id = ${id}`
  )
}

/** Same contract as {@link embedAndStoreForecast}, targeting external_markets (daatan#1640). */
export async function embedAndStoreExternalMarket(id: string, question: string): Promise<void> {
  const embedding = await embedText(question)
  if (!embedding) {
    throw new Error(`No embedding returned for external market ${id} — nothing stored`)
  }
  if (!embedding.every(Number.isFinite)) {
    throw new Error(`Embedding for external market ${id} contains non-finite values — nothing stored`)
  }
  const vectorStr = `[${embedding.join(',')}]`
  await prisma.$executeRaw(
    Prisma.sql`UPDATE external_markets SET embedding = ${Prisma.raw(`'${vectorStr}'::vector`)} WHERE id = ${id}`
  )
}
