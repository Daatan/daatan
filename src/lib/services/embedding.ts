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
 * Vertex path is broken; it is what to grep for after provisioning. The fallback
 * goes away with GEMINI_API_KEY once Vertex is proven in production.
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

export async function embedAndStoreForecast(id: string, claimText: string): Promise<void> {
  const embedding = await embedText(claimText)
  if (!embedding) return
  if (!embedding.every(Number.isFinite)) {
    log.warn({ id }, 'Embedding contains non-finite values — skipping store')
    return
  }
  const vectorStr = `[${embedding.join(',')}]`
  await prisma.$executeRaw(
    Prisma.sql`UPDATE predictions SET embedding = ${Prisma.raw(`'${vectorStr}'::vector`)} WHERE id = ${id}`
  )
}
