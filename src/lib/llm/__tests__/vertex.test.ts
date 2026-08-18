import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services/google-auth', () => ({
  googleAccessToken: vi.fn(async () => 'ya29.test-token'),
}))

import { googleAccessToken } from '@/lib/services/google-auth'
import { VertexProvider } from '@/lib/llm/providers/vertex'

const CONFIG = {
  projectId: 'daatan-654644841675',
  location: 'global',
  clientEmail: 'vertex@daatan.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  modelName: 'gemini-2.5-flash',
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

const CANDIDATE = {
  candidates: [{ content: { parts: [{ text: '{"answer":42}' }] } }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, totalTokenCount: 16 },
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(googleAccessToken).mockResolvedValue('ya29.test-token')
  fetchMock = vi.fn(async () => okResponse(CANDIDATE))
  vi.stubGlobal('fetch', fetchMock)
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse(init.body as string) }
}

describe('VertexProvider', () => {
  it('refuses a half-provisioned service account rather than registering a leg that fails every call', () => {
    expect(() => new VertexProvider({ ...CONFIG, privateKey: '' })).toThrow(/projectId, clientEmail and privateKey/)
    expect(() => new VertexProvider({ ...CONFIG, projectId: '' })).toThrow()
    expect(() => new VertexProvider({ ...CONFIG, clientEmail: '' })).toThrow()
  })

  it('calls the unprefixed host for `global` — the region-prefixed form 404s there', async () => {
    await new VertexProvider(CONFIG).generateContent({ prompt: 'hi' })
    expect(lastCall().url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/daatan-654644841675' +
        '/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
    )
  })

  it('prefixes the host for a regional location', async () => {
    await new VertexProvider({ ...CONFIG, location: 'europe-west4' }).generateContent({ prompt: 'hi' })
    expect(lastCall().url).toContain('https://europe-west4-aiplatform.googleapis.com/')
    expect(lastCall().url).toContain('/locations/europe-west4/')
  })

  it('authenticates with a cloud-platform bearer token, not an API key in the URL', async () => {
    await new VertexProvider(CONFIG).generateContent({ prompt: 'hi' })
    const { url, init } = lastCall()
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test-token')
    expect(url).not.toContain('key=')
    expect(googleAccessToken).toHaveBeenCalledWith(
      CONFIG.clientEmail,
      CONFIG.privateKey,
      'https://www.googleapis.com/auth/cloud-platform',
    )
  })

  it('passes the existing Schema straight through as responseSchema — no SDK translation', async () => {
    const schema = { type: 'object', properties: { answer: { type: 'number' } } }
    await new VertexProvider(CONFIG).generateContent({
      prompt: 'q',
      schema: schema as never,
      temperature: 0.2,
    })
    expect(lastCall().body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    })
  })

  it('asks for text/plain and omits the schema key entirely when no schema is given', async () => {
    await new VertexProvider(CONFIG).generateContent({ prompt: 'q' })
    const cfg = lastCall().body.generationConfig
    expect(cfg.responseMimeType).toBe('text/plain')
    expect('responseSchema' in cfg).toBe(false)
    expect('temperature' in cfg).toBe(false)
  })

  it('returns the candidate text and maps usage', async () => {
    const res = await new VertexProvider(CONFIG).generateContent({ prompt: 'q' })
    expect(res.text).toBe('{"answer":42}')
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 5, totalTokens: 16 })
  })

  it('omits usage when Vertex reports none, rather than inventing zeros', async () => {
    fetchMock.mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }))
    const res = await new VertexProvider(CONFIG).generateContent({ prompt: 'q' })
    expect(res.usage).toBeUndefined()
  })

  it('surfaces the response body on an error status — that is where Vertex puts the reason', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":{"message":"Permission aiplatform.endpoints.predict denied"}}',
    })
    await expect(new VertexProvider(CONFIG).generateContent({ prompt: 'q' })).rejects.toThrow(
      /Vertex 403.*aiplatform\.endpoints\.predict denied/,
    )
  })

  it('throws on a candidate-less response instead of handing an empty string downstream', async () => {
    fetchMock.mockResolvedValue(okResponse({ candidates: [] }))
    await expect(new VertexProvider(CONFIG).generateContent({ prompt: 'q' })).rejects.toThrow(
      /no candidate text/,
    )
  })

  // Real fetch rejects immediately on an already-aborted signal; the mock has to
  // do the same or it cannot distinguish "abort honoured" from "abort ignored".
  function abortAwareFetch() {
    return vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init.signal?.aborted) return reject(new Error('aborted'))
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
  }

  it("aborts the request when the caller's signal fires mid-flight", async () => {
    fetchMock = abortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const p = new VertexProvider(CONFIG).generateContent({ prompt: 'q', signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(p).rejects.toThrow('aborted')
  })

  it('honours an abort that lands during the token exchange, before any request is issued', async () => {
    fetchMock = abortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    // Suspend the provider inside the exchange, then abort while it is there.
    vi.mocked(googleAccessToken).mockImplementation(async () => {
      controller.abort()
      return 'ya29.test-token'
    })

    const p = new VertexProvider(CONFIG).generateContent({ prompt: 'q', signal: controller.signal })

    await expect(p).rejects.toThrow('aborted')
  })

  it('does not even start when the caller hands it an already-aborted signal', async () => {
    fetchMock = abortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(
      new VertexProvider(CONFIG).generateContent({ prompt: 'q', signal: controller.signal }),
    ).rejects.toThrow('aborted')
  })
})
