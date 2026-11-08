import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))

import { llmService } from '../index'
import { buildSearchQuery, SEARCH_QUERY_THINKING_BUDGET } from '../searchQuery'

describe('buildSearchQuery', () => {
  beforeEach(() => {
    vi.mocked(llmService.generateContent).mockReset()
  })

  it('runs the extraction with thinking off (daatan#1890)', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'Real Madrid Champions League' } as never)
    const q = await buildSearchQuery('Real Madrid will win the 2027 Champions League')
    expect(q).toBe('Real Madrid Champions League')
    expect(SEARCH_QUERY_THINKING_BUDGET).toBe(0)
    expect(llmService.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'search_query', thinkingBudget: 0, temperature: 0 }),
    )
  })

  it('falls back to the cleaned claim when the model fails', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValue(new Error('boom'))
    expect(await buildSearchQuery('🤖 Bitcoin will reach $100k | Daatan')).toBe('Bitcoin will reach $100k')
  })
})
