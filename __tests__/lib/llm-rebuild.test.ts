import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The main LLM service builds a cross-vendor fallback chain
 *   Gemini → Oracul (Bedrock/Nova) → OpenRouter → Ollama
 * where each leg registers ONLY when it's configured:
 *   - Gemini:     GEMINI_API_KEY set
 *   - Oracul:     getOracleConfig() non-null (ORACLE_URL + ORACLE_API_KEY)
 *   - OpenRouter: getOpenRouterKey() non-empty — BOTH editions. Self-host uses the
 *                 admin-chosen model; SaaS uses the free NON-Google backstop model.
 *   - Ollama:     OLLAMA_BASE_URL set (no implicit localhost default)
 * `rebuildLlmService()` re-runs this so a key added at runtime takes effect with no
 * restart (via the live ES binding).
 */

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

let orKey = ''
vi.mock('@/lib/services/settings', () => ({
  getOpenRouterKey: () => orKey,
  getOpenRouterModel: () => 'openai/gpt-4o-mini',
}))

let oracleConfigured = false
vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: () => (oracleConfigured ? { baseUrl: 'http://oracle', key: 'k' } : null),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Identify providers by a `kind` tag and capture the model each was built with.
vi.mock('@/lib/llm/providers/gemini', () => ({
  GeminiProvider: class { kind = 'gemini'; model: string; constructor(c: { modelName: string }) { this.model = c.modelName } },
}))
vi.mock('@/lib/llm/providers/ollama', () => ({
  OllamaProvider: class { kind = 'ollama'; baseUrl: string; constructor(c: { baseUrl: string }) { this.baseUrl = c.baseUrl } },
}))
vi.mock('@/lib/llm/providers/openrouter', () => ({
  OpenRouterProvider: class { kind = 'openrouter'; model: string; constructor(c: { modelName: string }) { this.model = c.modelName } },
}))
vi.mock('@/lib/llm/providers/oracle', () => ({
  OracleProvider: class { kind = 'oracle'; model: string; constructor(_c: unknown, model: string) { this.model = model } },
}))

type Built = { kind: string; model?: string; baseUrl?: string }
const built: Built[][] = []
vi.mock('@/lib/llm/service', () => ({
  ResilientLLMService: class {
    providers: Built[]
    constructor(providers: Built[]) {
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

const last = (): Built[] => built[built.length - 1]
const kinds = (): string[] => last().map((p) => p.kind)
const find = (kind: string): Built | undefined => last().find((p) => p.kind === kind)

const MANAGED_ENV = ['GEMINI_API_KEY', 'OLLAMA_BASE_URL'] as const
const savedEnv: Record<string, string | undefined> = {}

describe('buildProviders / rebuildLlmService', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    orKey = ''
    oracleConfigured = false
    for (const v of MANAGED_ENV) {
      savedEnv[v] = process.env[v]
      delete process.env[v]
    }
  })

  afterEach(() => {
    for (const v of MANAGED_ENV) {
      if (savedEnv[v] === undefined) delete process.env[v]
      else process.env[v] = savedEnv[v]
    }
  })

  it('registers OpenRouter on self_hosted with the admin-chosen model', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    orKey = 'sk-or-key'
    await load()
    expect(kinds()).toContain('openrouter')
    expect(find('openrouter')?.model).toBe('openai/gpt-4o-mini')
  })

  it('registers OpenRouter on SaaS too, using the free non-Google backstop model', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    orKey = 'sk-or-key'
    await load()
    expect(kinds()).toContain('openrouter')
    expect(find('openrouter')?.model).toBe('meta-llama/llama-3.3-70b-instruct:free')
  })

  it('does NOT register OpenRouter when no key is present', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    await load()
    expect(kinds()).not.toContain('openrouter')
  })

  it('registers the Oracle (nova-pro) only when the Oracle is configured', async () => {
    await load()
    expect(kinds()).not.toContain('oracle')

    oracleConfigured = true
    await load()
    expect(kinds()).toContain('oracle')
    expect(find('oracle')?.model).toBe('bedrock/amazon.nova-pro-v1:0')
  })

  it('registers Ollama only when OLLAMA_BASE_URL is set (no implicit localhost)', async () => {
    await load()
    expect(kinds()).not.toContain('ollama')

    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    await load()
    expect(kinds()).toContain('ollama')
    expect(find('ollama')?.baseUrl).toBe('http://localhost:11434')
  })

  it('orders the full chain Gemini → Oracle → OpenRouter → Ollama when all are configured', async () => {
    process.env.GEMINI_API_KEY = 'g-key'
    oracleConfigured = true
    orKey = 'sk-or-key'
    mockEnv.DAATAN_EDITION = 'saas'
    process.env.OLLAMA_BASE_URL = 'http://ollama'
    await load()
    expect(kinds()).toEqual(['gemini', 'oracle', 'openrouter', 'ollama'])
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
