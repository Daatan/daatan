/**
 * Dynamic golden of what actually leaves the process for every LLM call (daatan#2287).
 *
 * Builds the real provider chains with fake credentials, makes every leg fail (so the
 * chain walks all of them) and records each leg's outgoing request: URL, model,
 * generation params, message roles. Prompt text is replaced by `<prompt>`; structured
 * schemas are recorded once by value (`schemas` golden) and per call by hash.
 *
 * Covers: every stage (params taken from the call-site golden), the prod and the
 * self-host chain shapes, bot chains, every AI-panel member, the grounded-date lookup.
 * The model-registry refactor must leave all of it byte-identical.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectGolden } from './goldens/golden'

const ENV_KEYS = [
  'GOOGLE_VERTEX_PROJECT_ID',
  'GOOGLE_VERTEX_CLIENT_EMAIL',
  'GOOGLE_VERTEX_PRIVATE_KEY',
  'GOOGLE_VERTEX_LOCATION',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_BASE_URL',
  'LLM_STAGE_MODELS',
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

const edition = vi.hoisted(() => ({ selfHosted: false }))
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  isSelfHosted: () => edition.selfHosted,
}))
vi.mock('@/lib/services/google-auth', () => ({ googleAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/services/settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/settings')>()),
  getOpenRouterKey: () => 'or-test-key',
  getOpenRouterModel: () => 'admin/chosen-model',
}))
vi.mock('@/lib/services/telegram', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/telegram')>()),
  notifyLlmError: vi.fn(),
}))

interface Captured {
  leg: string
  url: string
  body: unknown
  region?: string
}
const captured: Captured[] = []

vi.mock('@/lib/services/oracleClient', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/oracleClient')>()),
  getOracleConfig: () => ({ baseUrl: 'https://oracle.test', key: 'oracle-test-key' }),
  oracleFetch: vi.fn(async (_cfg: unknown, p: string, init: { body: string; timeoutMs?: number }) => {
    captured.push({ leg: 'oracle', url: p, body: { ...scrub(JSON.parse(init.body)) as object, timeoutMs: init.timeoutMs } })
    return { ok: false, status: 503, text: async () => 'down', json: async () => ({}) }
  }),
}))

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    constructor(private readonly config: { region: string }) {}
    send = async (cmd: { input: Record<string, unknown> }) => {
      captured.push({ leg: 'bedrock', url: 'converse', region: this.config.region, body: scrub(cmd.input) })
      throw new Error('bedrock down (test)')
    }
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}))

/** Replace prompt text; keep fixed system text and every param. Hash schemas. */
function scrub(value: unknown): unknown {
  const v = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk)
    if (!o || typeof o !== 'object') return o
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'responseSchema' || k === 'json_schema') out[k] = `sha256:${sha(val)}`
      else if (k === 'text' && typeof val === 'string') out[k] = '<prompt>'
      else if (k === 'content' && typeof val === 'string') out[k] = val === PROMPT ? '<prompt>' : val
      else if (k === 'prompt' && typeof val === 'string') out[k] = '<prompt>'
      else if (k === 'content' && Array.isArray(val)) out[k] = walk(val)
      else out[k] = walk(val)
    }
    return out
  }
  return walk(v)
}

function sha(val: unknown): string {
  return createHash('sha256').update(JSON.stringify(val)).digest('hex').slice(0, 16)
}

const PROMPT = 'PROMPT-UNDER-TEST'

function failingFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    const leg = url.includes('aiplatform.googleapis.com')
      ? 'vertex'
      : url.includes('generativelanguage.googleapis.com')
        ? 'gemini'
        : url.includes('openrouter.ai')
          ? 'openrouter'
          : url.includes('ollama.test')
            ? 'ollama'
            : 'other'
    captured.push({ leg, url: url.split('?')[0], body: raw ? scrub(raw) : null })
    return new Response(JSON.stringify({ error: { code: 500, message: 'down (test)' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, values)
}

const VERTEX_ENV = {
  GOOGLE_VERTEX_PROJECT_ID: 'test-project',
  GOOGLE_VERTEX_CLIENT_EMAIL: 'llm@test-project.iam.gserviceaccount.com',
  GOOGLE_VERTEX_PRIVATE_KEY: 'test-private-key',
}

async function loadLlm(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, selfHosted: boolean) {
  setEnv(env)
  edition.selfHosted = selfHosted
  vi.resetModules()
  return import('@/lib/llm')
}

/** Every exported Gemini `Schema` a call site can pass, by identifier. */
async function loadSchemas(): Promise<Record<string, unknown>> {
  const mods = await Promise.all([
    import('@/lib/llm/schemas'),
    import('@/lib/llm/gemini'),
    import('@/lib/llm/expressPrediction'),
    import('@/lib/services/temporal-classifier'),
    import('@/lib/services/moderation'),
    import('@/lib/services/relation-typer'),
  ])
  const out: Record<string, unknown> = {}
  for (const m of mods) {
    for (const [k, v] of Object.entries(m)) if (/Schema$/.test(k) && v && typeof v === 'object') out[k] = v
  }
  return out
}

interface CallSite {
  stage: string
  file: string
  fallback: string | null
  params: Record<string, string>
}

/** `'EXPRESS_DRAFT_THINKING_BUDGET = 512'` → 512; `'0.2'` → 0.2. */
function literal(text: string): unknown {
  const value = text.includes(' = ') ? text.split(' = ').pop()! : text
  if (/^[\d_.]+$/.test(value)) return Number(value.replace(/_/g, ''))
  if (/^'.*'$/.test(value)) return value.slice(1, -1)
  return undefined
}

let fetchMock: ReturnType<typeof failingFetch>
beforeEach(() => {
  captured.length = 0
  fetchMock = failingFetch()
  vi.stubGlobal('fetch', fetchMock)
})
afterAll(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('LLM request goldens — outgoing requests (daatan#2287)', () => {
  it('schemas are sent unchanged', async () => {
    const schemas = await loadSchemas()
    expectGolden(
      'schemas',
      Object.fromEntries(Object.keys(schemas).sort().map((k) => [k, { sha256: sha(schemas[k]), schema: schemas[k] }])),
    )
  })

  it('every staged call site, prod chain shape (Vertex → Oracul → OpenRouter)', async () => {
    const schemas = await loadSchemas()
    const sites = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/lib/llm/__tests__/goldens/stage-call-sites.json'), 'utf8'),
    ) as CallSite[]
    const llm = await loadLlm({ ...VERTEX_ENV }, false)
    const { forStage } = await import('@/lib/llm/stageModels')
    const out: Record<string, unknown>[] = []
    for (const site of sites) {
      if (site.stage === '(unstaged)') continue
      captured.length = 0
      const p = site.params
      const fallback = site.fallback ? (literal(site.fallback) as string) : undefined
      const request = {
        ...forStage(site.stage as never, fallback),
        prompt: PROMPT,
        ...(p.temperature !== undefined ? { temperature: literal(p.temperature) as number } : {}),
        ...(p.thinkingBudget !== undefined ? { thinkingBudget: literal(p.thinkingBudget) as number } : {}),
        ...(p.googleTimeoutMs !== undefined ? { googleTimeoutMs: literal(p.googleTimeoutMs) as number } : {}),
        ...(p.schema !== undefined ? { schema: schemas[p.schema] as never } : {}),
      }
      if (p.schema !== undefined) expect(schemas[p.schema], `schema ${p.schema} not found`).toBeDefined()
      await expect(llm.llmService.generateContent(request)).rejects.toThrow()
      out.push({ stage: site.stage, file: site.file, legs: [...captured] })
    }
    expectGolden('chain-prod-stages', out)
  })

  it('research_verdict primaryOnly sends the Vertex leg only', async () => {
    const llm = await loadLlm({ ...VERTEX_ENV }, false)
    const { forStage } = await import('@/lib/llm/stageModels')
    await expect(
      llm.llmService.generateContent({
        ...forStage('research_verdict', 'gemini-2.5-pro'),
        prompt: PROMPT,
        temperature: 0,
        primaryOnly: true,
      }),
    ).rejects.toThrow()
    expectGolden('chain-prod-primary-only', captured)
  })

  it('LLM_STAGE_MODELS reaches the Google legs only', async () => {
    const llm = await loadLlm({ ...VERTEX_ENV, LLM_STAGE_MODELS: 'moderation=gemini-2.5-flash-lite' }, false)
    const { forStage } = await import('@/lib/llm/stageModels')
    await expect(
      llm.llmService.generateContent({ ...forStage('moderation'), prompt: PROMPT, temperature: 0 }),
    ).rejects.toThrow()
    expectGolden('chain-prod-stage-override', captured)
  })

  it('self-host chain shape (Gemini key → Oracul → OpenRouter admin model → Ollama)', async () => {
    const llm = await loadLlm({ GEMINI_API_KEY: 'gemini-test-key', OLLAMA_BASE_URL: 'http://ollama.test:11434' }, true)
    const out: Record<string, unknown>[] = []
    for (const [name, request] of [
      ['text', { prompt: PROMPT, temperature: 0 }],
      ['schema', { prompt: PROMPT, temperature: 0, schema: { type: 'object', properties: { a: { type: 'string' } } } }],
      ['no-temperature', { prompt: PROMPT }],
      ['thinking', { prompt: PROMPT, temperature: 0.2, thinkingBudget: 512 }],
    ] as const) {
      captured.length = 0
      await expect(llm.llmService.generateContent(request as never)).rejects.toThrow()
      out.push({ case: name, legs: [...captured] })
    }
    expectGolden('chain-selfhost', out)
  })

  it('bot chains by model preference', async () => {
    const llm = await loadLlm({ ...VERTEX_ENV, OPENROUTER_API_KEY: 'or-bot-key', GEMINI_API_KEY: 'gemini-test-key' }, false)
    const out: Record<string, unknown>[] = []
    for (const pref of [
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash-exp:free',
      'openai/gpt-5-mini',
      'meta-llama/llama-3.3-70b-instruct:free',
    ]) {
      captured.length = 0
      const svc = llm.createBotLLMService(pref)
      await expect(
        svc.generateContent({ prompt: PROMPT, temperature: 0.7, schema: { type: 'object' } as never, legTimeoutMs: 1000 }),
      ).rejects.toThrow()
      out.push({ preference: pref, legs: [...captured] })
    }
    expectGolden('chain-bots', out)
  })

  it('every AI-panel member (Bedrock / Vertex / OpenRouter routes)', async () => {
    setEnv({ ...VERTEX_ENV })
    vi.resetModules()
    const { callPanelMember } = await import('@/lib/llm/panel/client')
    const { PANEL_MEMBERS, GROUNDED_PANEL_MEMBERS } = await import('@/lib/llm/panel/roster')
    const members = [
      ...PANEL_MEMBERS,
      ...GROUNDED_PANEL_MEMBERS,
      // No live member uses this route today; pin its request shape anyway.
      { model: 'test/openrouter-member', mode: 'ungrounded', route: 'openrouter' } as const,
    ]
    const out: Record<string, unknown>[] = []
    for (const m of members) {
      captured.length = 0
      await callPanelMember(m as never, PROMPT, 'or-panel-key').catch(() => undefined)
      out.push({ member: { model: m.model, mode: m.mode, route: m.route, region: 'region' in m ? m.region : undefined }, requests: [...captured] })
    }
    expectGolden('panel-members', out)
  })

  it('grounded-date lookup (direct Vertex, googleSearch tool)', async () => {
    setEnv({ ...VERTEX_ENV })
    vi.resetModules()
    const { lookupGroundedEventDate } = await import('@/lib/llm/groundedDateLookup')
    await lookupGroundedEventDate('user input', 'claim text', new Date('2026-11-23T00:00:00Z'))
    expectGolden('grounded-date', captured)
  })
})
