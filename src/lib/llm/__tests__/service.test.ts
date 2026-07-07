import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/telegram', () => ({ notifyLlmError: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { ResilientLLMService } from '../service'
import { notifyLlmError } from '@/lib/services/telegram'
import type { LLMProvider } from '../types'

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
    const second = ok('Oracle', 'second')
    const svc = new ResilientLLMService([first, second])

    const res = await svc.generateContent({ prompt: 'x' })

    expect(res.text).toBe('first')
    expect(second.generateContent).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('falls through to a later provider and does NOT page when one rescues the call', async () => {
    const primary = fail('Gemini', '503 Service Unavailable')
    const backup = ok('Oracle', 'rescued')
    const svc = new ResilientLLMService([primary, backup])

    const res = await svc.generateContent({ prompt: 'x' })

    expect(res.text).toBe('rescued')
    expect(primary.generateContent).toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('pages once with the full provider chain only when every provider fails', async () => {
    const svc = new ResilientLLMService([fail('Gemini', '503'), fail('Oracle', '502')])

    await expect(svc.generateContent({ prompt: 'x' })).rejects.toThrow(/All LLM providers failed/)

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith('Gemini → Oracle', '502')
  })

  it('pages with "none" when no providers are configured', async () => {
    const svc = new ResilientLLMService([])

    await expect(svc.generateContent({ prompt: 'x' })).rejects.toThrow(/All LLM providers failed/)

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith('none', 'no LLM providers configured')
  })
})
