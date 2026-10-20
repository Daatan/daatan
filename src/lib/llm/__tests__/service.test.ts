import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/telegram', () => ({ notifyLlmError: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { ResilientLLMService } from '../service'
import { notifyLlmError } from '@/lib/services/telegram'
import type { LLMProvider, LLMRequest, LLMResponse } from '../types'

const mockNotify = vi.mocked(notifyLlmError)

const ok = (name: string, text: string): LLMProvider => ({
  name,
  generateContent: vi.fn(async () => ({ text })),
})
const fail = (name: string, msg: string): LLMProvider => ({
  name,
  generateContent: vi.fn(async () => {
    throw new Error(msg)
  }),
})

beforeEach(() => vi.clearAllMocks())

describe('ResilientLLMService', () => {
  it('returns the first provider result and never tries the rest', async () => {
    const first = ok('Gemini', 'first')
    const second = ok('Oracul', 'second')
    const svc = new ResilientLLMService([first, second])

    const res = await svc.generateContent({ prompt: 'x' })

    expect(res.text).toBe('first')
    expect(second.generateContent).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('falls through to a later provider and does NOT page when one rescues the call', async () => {
    const primary = fail('Gemini', '503 Service Unavailable')
    const backup = ok('Oracul', 'rescued')
    const svc = new ResilientLLMService([primary, backup])

    const res = await svc.generateContent({ prompt: 'x' })

    expect(res.text).toBe('rescued')
    expect(primary.generateContent).toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('pages once with the full provider chain only when every provider fails', async () => {
    const svc = new ResilientLLMService([fail('Gemini', '503'), fail('Oracul', '502')])

    await expect(svc.generateContent({ prompt: 'x' })).rejects.toThrow(/All LLM providers failed/)

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith('Gemini → Oracul', '502')
  })

  it('pages with "none" when no providers are configured', async () => {
    const svc = new ResilientLLMService([])

    await expect(svc.generateContent({ prompt: 'x' })).rejects.toThrow(/All LLM providers failed/)

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith('none', 'no LLM providers configured')
  })

  describe('per-leg budget (#1947)', () => {
    // A provider that hangs until its request signal aborts, like a real fetch.
    const hangs = (name: string): LLMProvider => ({
      name,
      generateContent: vi.fn(
        (req: LLMRequest) =>
          new Promise<LLMResponse>((_, reject) => {
            req.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
          }),
      ),
    })

    it('a slow first leg does not starve the fallback: each leg gets its own timeout', async () => {
      const slow = hangs('Vertex')
      const backup = ok('OpenRouter', 'rescued')
      const svc = new ResilientLLMService([slow, backup])

      const res = await svc.generateContent({
        prompt: 'x',
        signal: new AbortController().signal,
        legTimeoutMs: 30,
      })

      expect(res.text).toBe('rescued')
      const legSignal = vi.mocked(backup.generateContent).mock.calls[0][0].signal
      expect(legSignal?.aborted).toBe(false)
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('when every leg times out the error says "timeout" so the caller still retries', async () => {
      const svc = new ResilientLLMService([hangs('Vertex'), hangs('OpenRouter')])

      await expect(svc.generateContent({ prompt: 'x', legTimeoutMs: 20 })).rejects.toThrow(/timeout/)
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('stops the chain, without paging, once the caller itself has aborted', async () => {
      const controller = new AbortController()
      const first: LLMProvider = {
        name: 'Vertex',
        generateContent: vi.fn(async () => {
          controller.abort()
          throw new Error('aborted')
        }),
      }
      const second = ok('OpenRouter', 'never')
      const svc = new ResilientLLMService([first, second])

      await expect(svc.generateContent({ prompt: 'x', signal: controller.signal })).rejects.toThrow(/aborted by caller/)

      expect(second.generateContent).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('without legTimeoutMs the request is passed through untouched', async () => {
      const first = ok('Vertex', 'a')
      const svc = new ResilientLLMService([first])
      const req = { prompt: 'x', signal: new AbortController().signal }

      await svc.generateContent(req)

      expect(vi.mocked(first.generateContent).mock.calls[0][0]).toBe(req)
    })

    it('exposes the chain length', () => {
      expect(new ResilientLLMService([ok('a', '1'), ok('b', '2'), ok('c', '3')]).legCount).toBe(3)
    })
  })
})
