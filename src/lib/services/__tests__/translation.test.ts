import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture what gets sent to the LLM so we can assert on the filled prompt.
// vi.hoisted lets the mock fn exist before the (hoisted) vi.mock factory runs.
const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(async (_args: { prompt: string; temperature?: number }) => ({
    text: 'תרגום',
  })),
}))

vi.mock('@/lib/llm', () => ({ llmService: { generateContent } }))

// Use the real fillPrompt; stub only the template fetch to a known translate prompt.
vi.mock('@/lib/llm/bedrock-prompts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm/bedrock-prompts')>(
    '@/lib/llm/bedrock-prompts',
  )
  return {
    ...actual,
    getPromptTemplate: vi.fn(async () => 'Translate into {{language}}.\n\n{{text}}'),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/services/telegram', () => ({ notifyTranslationFailed: vi.fn() }))

import { callGeminiTranslate, languageName } from '../translation'

describe('languageName', () => {
  it('maps known locale codes to full English language names', () => {
    expect(languageName('he')).toBe('Hebrew')
    expect(languageName('ru')).toBe('Russian')
    expect(languageName('eo')).toBe('Esperanto')
    expect(languageName('en')).toBe('English')
  })

  it('falls back to the raw code for unknown locales', () => {
    expect(languageName('xx')).toBe('xx')
  })
})

describe('callGeminiTranslate', () => {
  beforeEach(() => generateContent.mockClear())

  it('passes the full language name (not the locale code) into the prompt', async () => {
    await callGeminiTranslate('Ebola will spread', 'he')
    const arg = generateContent.mock.calls[0][0]
    expect(arg.prompt).toContain('Translate into Hebrew.')
    expect(arg.prompt).not.toContain('Translate into he.')
    expect(arg.prompt).toContain('Ebola will spread')
  })

  it('trims surrounding whitespace from the model output', async () => {
    generateContent.mockResolvedValueOnce({ text: '  שלום  ' })
    expect(await callGeminiTranslate('hi', 'he')).toBe('שלום')
  })
})
