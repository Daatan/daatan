import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/services/google-auth', () => ({
  googleAccessToken: vi.fn(async () => 'ya29.test-token'),
}))

import { createBotLLMService } from '@/lib/llm'
import { VertexProvider } from '@/lib/llm/providers/vertex'
import { GeminiProvider } from '@/lib/llm/providers/gemini'

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_VERTEX_PROJECT_ID',
  'GOOGLE_VERTEX_CLIENT_EMAIL',
  'GOOGLE_VERTEX_PRIVATE_KEY',
] as const

const saved: Record<string, string | undefined> = {}

function providersOf(service: unknown): unknown[] {
  return (service as { providers: unknown[] }).providers
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('createBotLLMService (#1879)', () => {
  it('registers a Vertex leg for a Gemini bot when only Vertex is provisioned (prod shape)', () => {
    process.env.GOOGLE_VERTEX_PROJECT_ID = 'p'
    process.env.GOOGLE_VERTEX_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com'
    process.env.GOOGLE_VERTEX_PRIVATE_KEY = 'key'
    const providers = providersOf(createBotLLMService('google/gemini-2.5-flash-preview:free'))
    expect(providers).toHaveLength(1)
    expect(providers[0]).toBeInstanceOf(VertexProvider)
  })

  it('puts Vertex ahead of the key-based Gemini leg when both are set', () => {
    process.env.GOOGLE_VERTEX_PROJECT_ID = 'p'
    process.env.GOOGLE_VERTEX_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com'
    process.env.GOOGLE_VERTEX_PRIVATE_KEY = 'key'
    process.env.GEMINI_API_KEY = 'k'
    const providers = providersOf(createBotLLMService('google/gemini-2.5-flash'))
    expect(providers[0]).toBeInstanceOf(VertexProvider)
    expect(providers[1]).toBeInstanceOf(GeminiProvider)
  })

  it('has no Google leg for a non-Gemini bot', () => {
    process.env.GOOGLE_VERTEX_PROJECT_ID = 'p'
    process.env.GOOGLE_VERTEX_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com'
    process.env.GOOGLE_VERTEX_PRIVATE_KEY = 'key'
    expect(providersOf(createBotLLMService('meta-llama/llama-3.3-70b-instruct:free'))).toHaveLength(0)
  })
})
