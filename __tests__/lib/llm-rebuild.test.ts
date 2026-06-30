import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The main LLM service registers an OpenRouter provider only on self_hosted when
 * a key is configured (DB or env), and `rebuildLlmService()` re-runs that logic
 * so a key added at runtime takes effect with no restart (the live ES binding).
 */

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

let orKey = ''
vi.mock('@/lib/services/settings', () => ({
  getOpenRouterKey: () => orKey,
  getOpenRouterModel: () => 'openai/gpt-4o-mini',
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Identify providers by a `kind` tag; capture what the service is built with.
vi.mock('@/lib/llm/providers/gemini', () => ({ GeminiProvider: class { kind = 'gemini' } }))
vi.mock('@/lib/llm/providers/ollama', () => ({ OllamaProvider: class { kind = 'ollama' } }))
vi.mock('@/lib/llm/providers/openrouter', () => ({ OpenRouterProvider: class { kind = 'openrouter' } }))

const built: Array<Array<{ kind: string }>> = []
vi.mock('@/lib/llm/service', () => ({
  ResilientLLMService: class {
    providers: Array<{ kind: string }>
    constructor(providers: Array<{ kind: string }>) {
      this.providers = providers
      built.push(providers)
    }
  },
}))

async function load() {
  vi.resetModules()
  built.length = 0
  return import('@/lib/llm')
}

function kinds(): string[] {
  return built[built.length - 1].map((p) => p.kind)
}

describe('buildProviders / rebuildLlmService', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    orKey = ''
  })

  it('registers OpenRouter on self_hosted when a key is present', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    orKey = 'sk-or-key'
    await load()
    expect(kinds()).toContain('openrouter')
    expect(kinds()).toContain('ollama') // always the fallback
  })

  it('does NOT register OpenRouter on SaaS even with a key', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    orKey = 'sk-or-key'
    await load()
    expect(kinds()).not.toContain('openrouter')
  })

  it('does NOT register OpenRouter on self_hosted with no key', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    await load()
    expect(kinds()).not.toContain('openrouter')
  })

  it('rebuildLlmService picks up a key that becomes available (live, no restart)', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    const mod = await load()
    expect(kinds()).not.toContain('openrouter') // built cold, no key
    orKey = 'sk-or-late' // admin pastes the key into Settings
    mod.rebuildLlmService()
    expect(kinds()).toContain('openrouter') // rebuilt service now has it
  })
})
