import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/moderation', () => ({ checkContent: vi.fn() }))
vi.mock('../../utils/scraper', () => ({ fetchUrlContent: vi.fn() }))
vi.mock('../../services/oracleSearch', () => ({ oracleSearch: vi.fn() }))

import { generateExpressPrediction, NoArticlesFoundError } from '../expressPrediction'
import { checkContent } from '../../services/moderation'
import { fetchUrlContent } from '../../utils/scraper'
import { oracleSearch } from '../../services/oracleSearch'

describe('generateExpressPrediction — moderation gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips content moderation for a bare URL input (the article-import path)', async () => {
    // Even if the moderator would flag it, a URL must not be blocked here —
    // this is the regression that made Andrej's first attempt fail as "spam".
    vi.mocked(checkContent).mockResolvedValue({ isOffensive: true, reason: 'bare URL spam' })
    vi.mocked(fetchUrlContent).mockResolvedValue('') // force the search fallback
    vi.mocked(oracleSearch).mockResolvedValue([]) // no articles → NoArticlesFoundError

    await expect(
      generateExpressPrediction('https://news.walla.co.il/item/3845858'),
    ).rejects.toBeInstanceOf(NoArticlesFoundError)

    expect(checkContent).not.toHaveBeenCalled()
  })

  it('still moderates free-text input and blocks offensive content', async () => {
    vi.mocked(checkContent).mockResolvedValue({ isOffensive: true, reason: 'nope' })

    await expect(
      generateExpressPrediction('some clearly offensive free-text claim'),
    ).rejects.toThrow(/OFFENSIVE_INPUT/)

    expect(checkContent).toHaveBeenCalledOnce()
  })
})
