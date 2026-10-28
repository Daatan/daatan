import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/moderation', () => ({ checkContent: vi.fn(async () => ({ isOffensive: false, reason: '' })) }))
vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('../bedrock-prompts', () => ({ getPromptTemplate: vi.fn(async () => 'TEMPLATE'), fillPrompt: vi.fn(() => 'PROMPT') }))
vi.mock('../../services/translation', () => ({ localizeForecastForAuthor: vi.fn(async () => null), callGeminiTranslate: vi.fn() }))
vi.mock('../groundedDateLookup', () => ({ lookupGroundedEventDate: vi.fn() }))
vi.mock('../rulesDirection', () => ({ ensureRulesDirection: vi.fn() }))

import { generateExpressPrediction } from '../expressPrediction'
import { llmService } from '../index'
import { callGeminiTranslate, localizeForecastForAuthor } from '../../services/translation'
import { ensureRulesDirection } from '../rulesDirection'

// #1813: a rules rewrite must reach the author's localized preview too. Since #1890 C the
// preview is built beside the direction check, so a rewrite re-translates the rules alone.
const DRAFT = {
  claimText: 'The United States will not strike Iran by February 22, 2027.',
  resolveByDatetime: '2027-02-22T23:59:59Z',
  detailsText: 'Context.',
  tags: ['World'],
  resolutionRules: "Resolved as 'Yes' if the US strikes Iran.",
  outcomeType: 'BINARY',
  options: [],
  probabilitySuggestion: null,
  probabilityReasoning: '',
  relevantArticleIndices: [],
  dateBasis: 'explicit_in_claim',
}
const FIXED = "Resolved as 'Yes' if the US does not strike Iran by February 22, 2027."

function mockDraft(draft: Record<string, unknown>) {
  vi.mocked(llmService.generateContent).mockResolvedValue({ text: JSON.stringify(draft) } as never)
}

describe('generateExpressPrediction — rules direction (#1813)', () => {
  beforeEach(() => vi.clearAllMocks())

  const HE = { language: 'he', claimText: 'טענה', detailsText: 'הקשר', resolutionRules: 'כללים הפוכים', options: [] }

  it('uses the fixed rules in the result and in the localized preview', async () => {
    mockDraft(DRAFT)
    vi.mocked(ensureRulesDirection).mockResolvedValue({ direction: 'consistent', initial: 'inverted', rules: FIXED, fixed: true })
    vi.mocked(localizeForecastForAuthor).mockResolvedValueOnce(HE)
    vi.mocked(callGeminiTranslate).mockResolvedValueOnce(' כללים מתוקנים ')

    const result = await generateExpressPrediction('ארה"ב לא תתקוף את איראן', undefined, true)

    expect(ensureRulesDirection).toHaveBeenCalledWith(DRAFT.claimText, DRAFT.resolutionRules)
    expect(result.resolutionRules).toBe(FIXED)
    expect(result.rulesDirection).toEqual({ direction: 'consistent', initial: 'inverted', fixed: true })
    expect(callGeminiTranslate).toHaveBeenCalledWith(FIXED, 'he')
    expect(result.localized).toEqual({ ...HE, resolutionRules: 'כללים מתוקנים' })
  })

  it('builds the localized preview beside the direction check, not after it (#1890 C)', async () => {
    mockDraft(DRAFT)
    let release!: () => void
    vi.mocked(ensureRulesDirection).mockImplementation(() => new Promise(resolve => {
      release = () => resolve({ direction: 'consistent', initial: 'consistent', rules: DRAFT.resolutionRules, fixed: false })
    }))
    vi.mocked(localizeForecastForAuthor).mockResolvedValueOnce(HE)

    const pending = generateExpressPrediction('ארה"ב לא תתקוף את איראן', undefined, true)
    await vi.waitFor(() => expect(ensureRulesDirection).toHaveBeenCalled())
    expect(localizeForecastForAuthor).toHaveBeenCalled()
    release()

    const result = await pending
    expect(callGeminiTranslate).not.toHaveBeenCalled()
    expect(result.localized).toEqual(HE)
  })

  it('drops the preview to English if the rewritten rules cannot be re-translated', async () => {
    mockDraft(DRAFT)
    vi.mocked(ensureRulesDirection).mockResolvedValue({ direction: 'consistent', initial: 'inverted', rules: FIXED, fixed: true })
    vi.mocked(localizeForecastForAuthor).mockResolvedValueOnce(HE)
    vi.mocked(callGeminiTranslate).mockRejectedValueOnce(new Error('vertex down'))

    const result = await generateExpressPrediction('ארה"ב לא תתקוף את איראן', undefined, true)

    expect(result.resolutionRules).toBe(FIXED)
    expect(result.localized).toBeNull()
  })

  it('passes an unfixable verdict through for the review-screen warning', async () => {
    mockDraft(DRAFT)
    vi.mocked(ensureRulesDirection).mockResolvedValue({ direction: 'inverted', initial: 'inverted', rules: DRAFT.resolutionRules, fixed: false })

    const result = await generateExpressPrediction('the US will not strike Iran', undefined, true)

    expect(result.resolutionRules).toBe(DRAFT.resolutionRules)
    expect(result.rulesDirection?.direction).toBe('inverted')
  })

  it('does not check multiple-choice forecasts', async () => {
    mockDraft({ ...DRAFT, claimText: 'Who will win?', outcomeType: 'MULTIPLE_CHOICE', options: ['A', 'B', 'Other'] })

    const result = await generateExpressPrediction('who will win', undefined, true)

    expect(ensureRulesDirection).not.toHaveBeenCalled()
    expect(result.rulesDirection).toBeNull()
  })
})
