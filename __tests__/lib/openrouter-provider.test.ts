import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenRouterProvider } from '@/lib/llm/providers/openrouter'

// Stub the global fetch — each test will configure it via vi.mocked(fetch)
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** Build a minimal OpenAI-compatible chat completion response. */
function makeApiResponse(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  return {
    choices: [{ message: { content } }],
    usage,
  }
}

/** Wrap a value in a Response-like object that fetch would return. */
function okResponse(body: object) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  }
}

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('throws when apiKey is not provided', () => {
      expect(() => new OpenRouterProvider({ apiKey: '', modelName: 'gpt-4o-mini' })).toThrow(
        'OpenRouter API key is required',
      )
    })

    it('throws when apiKey is undefined', () => {
      expect(() => new OpenRouterProvider({ apiKey: undefined, modelName: 'gpt-4o-mini' })).toThrow(
        'OpenRouter API key is required',
      )
    })

    it('constructs successfully with a valid config', () => {
      expect(
        () => new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' }),
      ).not.toThrow()
    })

    it('uses custom baseUrl when provided', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('hello')))

      const provider = new OpenRouterProvider({
        apiKey: 'sk-test',
        modelName: 'gpt-4o-mini',
        baseUrl: 'https://custom.proxy.io/v1',
      })
      await provider.generateContent({ prompt: 'hi' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.proxy.io/v1/chat/completions',
        expect.anything(),
      )
    })

    it('defaults baseUrl to openrouter.ai when not provided', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('hello')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'hi' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.anything(),
      )
    })
  })

  describe('generateContent — success', () => {
    it('returns text from the first choice message content', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('The answer is 42.')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      const result = await provider.generateContent({ prompt: 'What is the answer?' })

      expect(result.text).toBe('The answer is 42.')
    })

    it('returns empty string when message content is null', async () => {
      mockFetch.mockResolvedValue(
        okResponse({ choices: [{ message: { content: null } }] }),
      )

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      const result = await provider.generateContent({ prompt: 'hi' })

      expect(result.text).toBe('')
    })

    it('sends the app URL as the HTTP-Referer header', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('ok')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'hi' })

      const [, init] = mockFetch.mock.calls[0]
      expect(init.headers['HTTP-Referer']).toBe('https://daatan.com')
    })

    it('maps usage fields correctly', async () => {
      mockFetch.mockResolvedValue(
        okResponse(
          makeApiResponse('ok', {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          }),
        ),
      )

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      const result = await provider.generateContent({ prompt: 'hi' })

      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      })
    })

    it('returns undefined usage when API does not include usage', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('hello')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      const result = await provider.generateContent({ prompt: 'hi' })

      expect(result.usage).toBeUndefined()
    })

    it('defaults missing usage sub-fields to 0', async () => {
      mockFetch.mockResolvedValue(
        okResponse({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      )

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      const result = await provider.generateContent({ prompt: 'hi' })

      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
    })

    it('uses default temperature of 0.7 when not specified', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('ok')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'hi' })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.temperature).toBe(0.7)
    })

    it('forwards a custom temperature', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('ok')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'hi', temperature: 0.1 })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.temperature).toBe(0.1)
    })

    it('sends the model name in the request body', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('ok')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'meta-llama/llama-3' })
      await provider.generateContent({ prompt: 'hi' })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('meta-llama/llama-3')
    })

    it('sends Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('ok')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-my-key', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'hi' })

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer sk-my-key')
    })
  })

  describe('generateContent — schema / system message', () => {
    it('prepends a JSON system message when schema is provided', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('{"result":true}')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'Classify this', schema: {} as never })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[0].content).toContain('JSON')
      // User message must still be present
      expect(body.messages[1]).toMatchObject({ role: 'user', content: 'Classify this' })
    })

    it('does not include a system message when schema is absent', async () => {
      mockFetch.mockResolvedValue(okResponse(makeApiResponse('Plain text response')))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })
      await provider.generateContent({ prompt: 'Just chat' })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const systemMessages = body.messages.filter((m: { role: string }) => m.role === 'system')
      expect(systemMessages).toHaveLength(0)
    })
  })

  describe('generateContent — errors', () => {
    it('throws on non-200 HTTP status with status code and body in message', async () => {
      mockFetch.mockResolvedValue(errorResponse(429, 'Rate limit exceeded'))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })

      await expect(provider.generateContent({ prompt: 'hi' })).rejects.toThrow(
        'OpenRouter API error 429: Rate limit exceeded',
      )
    })

    it('throws on 401 Unauthorized', async () => {
      mockFetch.mockResolvedValue(errorResponse(401, 'Invalid API key'))

      const provider = new OpenRouterProvider({ apiKey: 'sk-bad', modelName: 'gpt-4o-mini' })

      await expect(provider.generateContent({ prompt: 'hi' })).rejects.toThrow(
        'OpenRouter API error 401',
      )
    })

    it('throws when choices array is empty', async () => {
      mockFetch.mockResolvedValue(okResponse({ choices: [] }))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })

      await expect(provider.generateContent({ prompt: 'hi' })).rejects.toThrow(
        'OpenRouter returned no choices',
      )
    })

    it('throws when choices is missing from response', async () => {
      mockFetch.mockResolvedValue(okResponse({ usage: {} }))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })

      await expect(provider.generateContent({ prompt: 'hi' })).rejects.toThrow(
        'OpenRouter returned no choices',
      )
    })

    it('propagates network-level fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const provider = new OpenRouterProvider({ apiKey: 'sk-test', modelName: 'gpt-4o-mini' })

      await expect(provider.generateContent({ prompt: 'hi' })).rejects.toThrow('ECONNREFUSED')
    })
  })
})
