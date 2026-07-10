import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { callPanelMember, PanelAuthError } from '../client'
import type { PanelMember } from '../roster'

const MEMBER: PanelMember = {
  model: 'qwen/qwen3-235b-a22b-2507',
  mode: 'ungrounded',
  providerOrder: ['deepinfra/fp8'],
}

function respond(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

function content(text: string, usage?: Record<string, number>) {
  return respond(200, { choices: [{ message: { content: text } }], usage })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('callPanelMember request shape', () => {
  it('disables reasoning, caps output, pins the provider, and pins temperature 0', async () => {
    fetchMock.mockResolvedValue(content('{"probability": 42}'))

    await callPanelMember(MEMBER, 'prompt', 'sk-test')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // Hidden reasoning bills at the output rate (Gemini ~9x) and can't explain a line.
    expect(body.reasoning).toEqual({ enabled: false })
    expect(body.max_tokens).toBe(64)
    expect(body.temperature).toBe(0)
    // Unpinned, OpenRouter may serve a different quantization run-to-run.
    expect(body.provider).toEqual({ order: ['deepinfra/fp8'], allow_fallbacks: false })
    expect(body.model).toBe(MEMBER.model)
    expect(body.response_format.json_schema.strict).toBe(true)
  })
})

describe('callPanelMember responses', () => {
  it('returns the probability and usage', async () => {
    fetchMock.mockResolvedValue(
      content('{"probability": 42}', { prompt_tokens: 250, completion_tokens: 12 }),
    )

    const r = await callPanelMember(MEMBER, 'p', 'sk-test')

    expect(r.probability).toBe(42)
    expect(r.promptTokens).toBe(250)
    expect(r.completionTokens).toBe(12)
  })

  it('treats an explicit null as an abstention, not an error', async () => {
    fetchMock.mockResolvedValue(content('{"probability": null}'))
    await expect(callPanelMember(MEMBER, 'p', 'sk-test')).resolves.toMatchObject({
      probability: null,
    })
  })

  it('rejects an out-of-range probability rather than charting it', async () => {
    fetchMock.mockResolvedValue(content('{"probability": 140}'))
    await expect(callPanelMember(MEMBER, 'p', 'sk-test')).rejects.toThrow(/out-of-range/)
  })

  it('rejects non-JSON, in case a provider ignored response_format', async () => {
    fetchMock.mockResolvedValue(content('about 42 percent'))
    await expect(callPanelMember(MEMBER, 'p', 'sk-test')).rejects.toThrow(/non-JSON/)
  })
})

describe('auth failures are their own type', () => {
  // Regression: staging returned 401 "User not found." for all five members on all 57
  // forecasts — 285 identical warnings, and the cron still reported success.
  it('throws PanelAuthError on 401', async () => {
    fetchMock.mockResolvedValue(
      respond(401, { error: { message: 'User not found.', code: 401 } }, false),
    )

    const err = await callPanelMember(MEMBER, 'p', 'sk-dead').catch((e) => e)

    expect(err).toBeInstanceOf(PanelAuthError)
    expect(err.status).toBe(401)
  })

  it('throws PanelAuthError on 403', async () => {
    fetchMock.mockResolvedValue(respond(403, 'forbidden', false))
    await expect(callPanelMember(MEMBER, 'p', 'sk-x')).rejects.toBeInstanceOf(PanelAuthError)
  })

  it('a 500 is a plain Error — retryable, not a credential problem', async () => {
    fetchMock.mockResolvedValue(respond(500, 'upstream boom', false))

    const err = await callPanelMember(MEMBER, 'p', 'sk-test').catch((e) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PanelAuthError)
  })

  it('never leaks the api key into the error message', async () => {
    fetchMock.mockResolvedValue(respond(401, 'nope', false))

    const err = await callPanelMember(MEMBER, 'p', 'sk-or-v1-supersecret').catch((e) => e)

    expect(err.message).not.toContain('supersecret')
  })
})
