import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Oracul client so the provider never touches prisma/env/network.
vi.mock('@/lib/services/oracleClient', () => ({
  oracleFetch: vi.fn(),
}))

import { OracleProvider } from '../providers/oracle'
import { oracleFetch } from '@/lib/services/oracleClient'

const mockFetch = vi.mocked(oracleFetch)
const cfg = { baseUrl: 'http://oracle', key: 'k' }

const bodyOf = (callIndex: number) =>
  JSON.parse(mockFetch.mock.calls[callIndex][2].body as string)

beforeEach(() => vi.clearAllMocks())

describe('OracleProvider', () => {
  it('POSTs model + user message to /llm and returns the content text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: 'hello', model: 'bedrock/amazon.nova-pro-v1:0' }),
    } as never)

    const provider = new OracleProvider(cfg, 'bedrock/amazon.nova-pro-v1:0')
    const res = await provider.generateContent({ prompt: 'hi', temperature: 0.1 })

    expect(res.text).toBe('hello')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [passedCfg, path] = mockFetch.mock.calls[0]
    expect(passedCfg).toBe(cfg)
    expect(path).toBe('/llm')
    const body = bodyOf(0)
    expect(body.model).toBe('bedrock/amazon.nova-pro-v1:0')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.temperature).toBe(0.1)
  })

  it('prepends a JSON system message for schema requests', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: '{}' }),
    } as never)

    const provider = new OracleProvider(cfg, 'm')
    await provider.generateContent({ prompt: 'give json', schema: { type: 'object' } as never })

    const body = bodyOf(0)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'give json' })
  })

  it('throws on a non-ok Oracle response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'LLM call failed: boom',
    } as never)

    const provider = new OracleProvider(cfg, 'm')
    await expect(provider.generateContent({ prompt: 'x' })).rejects.toThrow(/Oracle \/llm error 502/)
  })

  it('throws when the response carries no content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'm' }),
    } as never)

    const provider = new OracleProvider(cfg, 'm')
    await expect(provider.generateContent({ prompt: 'x' })).rejects.toThrow(/no content/)
  })
})
