import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { $executeRaw: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/services/google-auth', () => ({
  googleAccessToken: vi.fn(async () => 'ya29.test-token'),
}))

import { embedText, embedAndStoreForecast } from '../embedding'
import { prisma } from '@/lib/prisma'

const FAKE_768 = Array.from({ length: 768 }, (_, i) => i / 768)

const VERTEX_ENV = {
  GOOGLE_VERTEX_PROJECT_ID: 'daatan-654644841675',
  GOOGLE_VERTEX_CLIENT_EMAIL: 'vertex@daatan.iam.gserviceaccount.com',
  GOOGLE_VERTEX_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
}

/** The Vertex leg is env-gated; unset it so these exercise the Developer API. */
function clearVertexEnv() {
  for (const k of Object.keys(VERTEX_ENV)) delete process.env[k]
  delete process.env.GOOGLE_VERTEX_LOCATION
}

function setVertexEnv() {
  Object.assign(process.env, VERTEX_ENV)
}

function embedResponse(values: number[] = FAKE_768) {
  return new Response(JSON.stringify({ embedding: { values } }), { status: 200 })
}

describe('embedText', () => {
  const originalEnv = process.env.GEMINI_API_KEY

  beforeEach(() => {
    clearVertexEnv()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv
    vi.unstubAllGlobals()
  })

  it('returns null and does not fetch when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY
    const result = await embedText('hello')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 768-dim vector on successful API call', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.mocked(fetch).mockResolvedValue(embedResponse())

    const result = await embedText('some text')
    expect(result).toHaveLength(768)
    expect(result![0]).toBeCloseTo(0)
  })

  it('passes outputDimensionality: 768 in the request body', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.mocked(fetch).mockResolvedValue(embedResponse())

    await embedText('test')

    const [, opts] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.outputDimensionality).toBe(768)
    expect(body.model).toContain('gemini-embedding-2')
  })

  it('returns null on non-200 API response', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
    )

    const result = await embedText('hello')
    expect(result).toBeNull()
  })

  it('returns null on fetch error', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.mocked(fetch).mockRejectedValue(new Error('network error'))

    const result = await embedText('hello')
    expect(result).toBeNull()
  })

  it('returns null when dimension does not match 768', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.mocked(fetch).mockResolvedValue(embedResponse([1, 2, 3]))

    const result = await embedText('hello')
    expect(result).toBeNull()
  })
})

describe('embedText via Vertex (#1472)', () => {
  const originalEnv = process.env.GEMINI_API_KEY

  beforeEach(() => {
    setVertexEnv()
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    clearVertexEnv()
    process.env.GEMINI_API_KEY = originalEnv
    vi.unstubAllGlobals()
  })

  it('prefers Vertex when the service account is provisioned, and never touches the key path', async () => {
    vi.mocked(fetch).mockResolvedValue(embedResponse())

    const result = await embedText('hello')

    expect(result).toHaveLength(768)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/daatan-654644841675' +
        '/locations/global/publishers/google/models/gemini-embedding-2:embedContent'
    )
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ya29.test-token' })
    expect(String(url)).not.toContain('key=')
  })

  it('sends the same body minus the `model` field — Vertex takes the model from the URL', async () => {
    vi.mocked(fetch).mockResolvedValue(embedResponse())

    await embedText('hello')

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ content: { parts: [{ text: 'hello' }] }, outputDimensionality: 768 })
  })

  it('reads the plural `embeddings[]` response shape too', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [{ values: FAKE_768 }] }), { status: 200 })
    )

    expect(await embedText('hello')).toHaveLength(768)
  })

  it('falls back to the Developer API when Vertex errors, rather than leaving the forecast unembedded', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('{"error":{"message":"aiplatform.user missing"}}', { status: 403 }))
      .mockResolvedValueOnce(embedResponse())

    const result = await embedText('hello')

    expect(result).toHaveLength(768)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('generativelanguage.googleapis.com')
  })

  it('falls back when Vertex answers with the wrong dimension — a short vector must never reach pgvector', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(embedResponse([1, 2, 3]))
      .mockResolvedValueOnce(embedResponse())

    expect(await embedText('hello')).toHaveLength(768)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns null when both legs fail', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'))

    expect(await embedText('hello')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('embedAndStoreForecast', () => {
  beforeEach(() => {
    clearVertexEnv()
    process.env.GEMINI_API_KEY = 'fake-key'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('calls $executeRaw to update the embedding column', async () => {
    vi.mocked(fetch).mockResolvedValue(embedResponse())
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1)

    await embedAndStoreForecast('pred-1', 'claim text')

    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
  })

  it('does not call $executeRaw if embedding fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))

    await embedAndStoreForecast('pred-1', 'claim text')

    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })
})
