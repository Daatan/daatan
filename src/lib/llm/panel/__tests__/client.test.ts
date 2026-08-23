import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const bedrockSend = vi.fn()
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  // Classes, not vi.fn(() => ...): the client constructs these with `new`.
  BedrockRuntimeClient: class {
    send = bedrockSend
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { callPanelMember, PanelAuthError, PanelPaymentError } from '../client'
import type { PanelMember } from '../roster'

const MEMBER: PanelMember = {
  model: 'qwen/qwen3-235b-a22b-2507',
  mode: 'ungrounded',
  route: 'openrouter',
  providerOrder: ['deepinfra/fp8'],
}

const BEDROCK_MEMBER: PanelMember = {
  model: 'qwen.qwen3-235b-a22b-2507-v1:0',
  mode: 'ungrounded',
  route: 'bedrock',
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
  bedrockSend.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function converse(text: string, usage?: { inputTokens: number; outputTokens: number }) {
  return { output: { message: { content: [{ text }] } }, usage }
}

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

  it('sends the app URL as the HTTP-Referer header', async () => {
    fetchMock.mockResolvedValue(content('{"probability": 42}'))

    await callPanelMember(MEMBER, 'prompt', 'sk-test')

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers['HTTP-Referer']).toBe('https://daatan.com')
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

  // Regression: 2026-08-19 05:06–05:12Z, 572 × 402 = total panel outage (daatan#1491).
  it('throws PanelPaymentError on 402 — credit exhaustion, not a credential problem', async () => {
    fetchMock.mockResolvedValue(
      respond(402, { error: { message: 'Insufficient credits', code: 402 } }, false),
    )
    const err = await callPanelMember(MEMBER, 'p', 'sk-x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PanelPaymentError)
    // Not an auth error: a top-up fixes it without a deploy, so the sweep must not latch.
    expect(err).not.toBeInstanceOf(PanelAuthError)
    expect((err as Error).message).toContain('402')
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

describe('bedrock route', () => {
  it('invokes Converse with maxTokens and temperature 0, never touching fetch', async () => {
    bedrockSend.mockResolvedValue(
      converse('{"probability": 37}', { inputTokens: 210, outputTokens: 9 }),
    )

    const r = await callPanelMember(BEDROCK_MEMBER, 'prompt', '')

    expect(fetchMock).not.toHaveBeenCalled()
    const { input } = bedrockSend.mock.calls[0][0]
    expect(input.modelId).toBe('qwen.qwen3-235b-a22b-2507-v1:0')
    expect(input.inferenceConfig).toEqual({ maxTokens: 64, temperature: 0 })
    expect(r).toMatchObject({ probability: 37, promptTokens: 210, completionTokens: 9 })
  })

  it('passes an abort signal so a hung Converse call cannot stall a sweep worker', async () => {
    bedrockSend.mockResolvedValue(converse('{"probability": 37}'))

    await callPanelMember(BEDROCK_MEMBER, 'p', '')

    const opts = bedrockSend.mock.calls[0][1] as { abortSignal?: AbortSignal }
    expect(opts?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(opts?.abortSignal?.aborted).toBe(false)
  })

  it('needs no OpenRouter key — that is the entire point of this route', async () => {
    bedrockSend.mockResolvedValue(converse('{"probability": 50}'))
    await expect(callPanelMember(BEDROCK_MEMBER, 'p', '')).resolves.toMatchObject({
      probability: 50,
    })
  })

  // Bedrock's Converse has no `response_format`, so the model may wrap its object.
  it('tolerates a ```json fence, since Converse cannot enforce a schema', async () => {
    bedrockSend.mockResolvedValue(converse('```json\n{"probability": 12}\n```'))
    await expect(callPanelMember(BEDROCK_MEMBER, 'p', '')).resolves.toMatchObject({
      probability: 12,
    })
  })

  it('tolerates a leading sentence', async () => {
    bedrockSend.mockResolvedValue(converse('Here is my estimate: {"probability": 88}'))
    await expect(callPanelMember(BEDROCK_MEMBER, 'p', '')).resolves.toMatchObject({
      probability: 88,
    })
  })

  it('still rejects prose with no object — never invents a number', async () => {
    bedrockSend.mockResolvedValue(converse('I would say roughly forty percent.'))
    await expect(callPanelMember(BEDROCK_MEMBER, 'p', '')).rejects.toThrow(/non-JSON/)
  })

  it('still validates the value strictly after extraction', async () => {
    bedrockSend.mockResolvedValue(converse('```json\n{"probability": 999}\n```'))
    await expect(callPanelMember(BEDROCK_MEMBER, 'p', '')).rejects.toThrow(/out-of-range/)
  })

  // The IAM grant may not be applied yet. That must degrade to an abstention for THIS
  // member, never to a PanelAuthError — which would disable the OpenRouter members too.
  it('an AccessDeniedException is a plain Error, not a PanelAuthError', async () => {
    const denied = Object.assign(new Error('User is not authorized to perform bedrock:InvokeModel'), {
      name: 'AccessDeniedException',
    })
    bedrockSend.mockRejectedValue(denied)

    const err = await callPanelMember(BEDROCK_MEMBER, 'p', '').catch((e) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PanelAuthError)
  })
})
