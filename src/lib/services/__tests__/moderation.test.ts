import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('../../llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(async () => 'TEMPLATE'),
  fillPrompt: vi.fn(() => 'PROMPT'),
}))

import { checkContent } from '../moderation'
import { llmService } from '../../llm'

describe('checkContent — daatan#1318 fail-open regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flags content for manual review instead of silently passing it on an LLM error', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValue(new Error('provider timeout'))

    const result = await checkContent('some forecast claim text', 'forecast')

    // Still publishable — a transient provider outage must not hard-block
    // publishing — but distinguishable from a real "checked and clean" pass.
    expect(result.isOffensive).toBe(false)
    expect(result.checkFailed).toBe(true)
  })

  it('flags a malformed LLM response the same way as a thrown error', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'not valid json' } as never)

    const result = await checkContent('some comment text', 'comment')

    expect(result.isOffensive).toBe(false)
    expect(result.checkFailed).toBe(true)
  })

  it('returns the real verdict unaffected when the LLM succeeds (clean content)', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: JSON.stringify({ isOffensive: false, reason: '' }),
    } as never)

    const result = await checkContent('a perfectly normal forecast claim', 'forecast')

    expect(result).toEqual({ isOffensive: false, reason: '' })
    expect(result.checkFailed).toBeUndefined()
  })

  it('returns the real verdict unaffected when the LLM succeeds (offensive content)', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: JSON.stringify({ isOffensive: true, reason: 'hate speech' }),
    } as never)

    const result = await checkContent('some offensive claim', 'comment')

    expect(result).toEqual({ isOffensive: true, reason: 'hate speech' })
    expect(result.checkFailed).toBeUndefined()
  })

  it('does not call the LLM (and does not flag) for empty content', async () => {
    const result = await checkContent('   ', 'comment')

    expect(result).toEqual({ isOffensive: false, reason: '' })
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })
})
