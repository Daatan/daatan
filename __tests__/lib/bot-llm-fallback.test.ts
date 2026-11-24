import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Capture provider constructor args (hoisted so the vi.mock factories can use them).
const { openRouterCtor } = vi.hoisted(() => ({ openRouterCtor: vi.fn() }))

vi.mock('@/lib/llm/providers/openrouter', () => ({
  OpenRouterProvider: class {
    name = 'OpenRouter'
    generateContent = vi.fn()
    constructor(cfg: unknown) {
      openRouterCtor(cfg)
    }
  },
}))

describe('createBotLLMService — OpenRouter fallback model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Isolate the OpenRouter leg: with no Gemini key, the direct/stable Gemini
    // legs are skipped, so the only provider registered is OpenRouter.
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test')
    vi.stubEnv('GEMINI_API_KEY', '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('uses the non-Google backstop model on the OpenRouter leg for a Gemini-preference bot', async () => {
    const { createBotLLMService } = await import('@/lib/llm')
    createBotLLMService('google/gemini-2.5-flash-preview:free')

    expect(openRouterCtor).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'meta-llama/llama-3.3-70b-instruct' }),
    )
  })

  it('passes a non-Gemini OpenRouter preference through unchanged', async () => {
    const { createBotLLMService } = await import('@/lib/llm')
    createBotLLMService('meta-llama/llama-3.3-70b-instruct')

    expect(openRouterCtor).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'meta-llama/llama-3.3-70b-instruct' }),
    )
  })
})
