import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))

import { ensureRulesDirection } from '../rulesDirection'
import { llmService } from '../index'

const CLAIM = 'The United States will not conduct a military strike against Iran by February 22, 2026.'
const RULES = "Resolved as 'Yes' if major news agencies report that the US military has conducted a strike against Iran."
const FIXED = "Resolved as 'Yes' if no major news agency reports a US military strike against Iran by February 22, 2026."

const verdict = (direction: string, fixedRules = '') =>
  ({ text: JSON.stringify({ yesCondition: 'x', direction, fixedRules }) }) as never

describe('ensureRulesDirection (#1813)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leaves consistent rules alone after one call', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(verdict('consistent'))

    const out = await ensureRulesDirection(CLAIM, FIXED)

    expect(out).toEqual({ direction: 'consistent', initial: 'consistent', rules: FIXED, fixed: false })
    expect(llmService.generateContent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(llmService.generateContent).mock.calls[0][0]).toMatchObject({ stage: 'rules_direction', temperature: 0 })
  })

  it('swaps in the rewrite when the re-check calls it consistent', async () => {
    vi.mocked(llmService.generateContent)
      .mockResolvedValueOnce(verdict('inverted', FIXED))
      .mockResolvedValueOnce(verdict('consistent'))

    const out = await ensureRulesDirection(CLAIM, RULES)

    expect(out).toEqual({ direction: 'consistent', initial: 'inverted', rules: FIXED, fixed: true })
    expect(vi.mocked(llmService.generateContent).mock.calls[1][0].prompt).toContain(FIXED)
  })

  it('keeps the original rules and reports inverted when the rewrite is still inverted', async () => {
    vi.mocked(llmService.generateContent)
      .mockResolvedValueOnce(verdict('inverted', 'still wrong'))
      .mockResolvedValueOnce(verdict('inverted', 'still wrong'))

    const out = await ensureRulesDirection(CLAIM, RULES)

    expect(out).toEqual({ direction: 'inverted', initial: 'inverted', rules: RULES, fixed: false })
  })

  it('reports inverted without a second call when no rewrite came back', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(verdict('inverted', '  '))

    const out = await ensureRulesDirection(CLAIM, RULES)

    expect(out.direction).toBe('inverted')
    expect(llmService.generateContent).toHaveBeenCalledTimes(1)
  })

  it('reports unclear without touching the rules', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(verdict('unclear'))

    const out = await ensureRulesDirection(CLAIM, 'CNN report')

    expect(out).toEqual({ direction: 'unclear', initial: 'unclear', rules: 'CNN report', fixed: false })
  })

  it('fails open on an LLM error', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('provider timeout'))

    const out = await ensureRulesDirection(CLAIM, RULES)

    expect(out).toEqual({ direction: 'error', initial: 'error', rules: RULES, fixed: false })
  })

  it('fails open on unparseable output', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce({ text: 'not json' } as never)

    expect((await ensureRulesDirection(CLAIM, RULES)).direction).toBe('error')
  })

  it('skips the call for empty rules', async () => {
    const out = await ensureRulesDirection(CLAIM, '  ')

    expect(out.direction).toBe('unclear')
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })
})
