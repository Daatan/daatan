import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../index', () => ({ llmService: { generateContent: vi.fn() } }))

import { checkRulesStrength } from '../rulesStrength'
import { llmService } from '../index'

const CLAIM = 'Israel will require foreign airlines to submit pilot details in advance, by October 31, 2026.'
const RULES = 'Resolves YES if Israel officially announces or implements a requirement that foreign airlines submit pilot details.'
const FIXED = 'Resolves YES if a requirement that foreign airlines submit pilot details in advance is in force by October 31, 2026.'

const reply = (o: Record<string, unknown>) => ({ text: JSON.stringify({ yesTrigger: 'x', fixedRules: '', ...o }) }) as never

describe('checkRulesStrength (#1803, shadow)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports ok with no rewrite when the rules match the claim', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply({ weaker: false, kind: 'none', fixedRules: 'ignored' }))

    const out = await checkRulesStrength(CLAIM, FIXED)

    expect(out).toEqual({ verdict: 'ok', kind: 'none', yesTrigger: 'x', fixedRules: '' })
    expect(vi.mocked(llmService.generateContent).mock.calls[0][0]).toMatchObject({ stage: 'rules_strength', temperature: 0 })
  })

  it('reports weaker with kind and the judge rewrite, without applying it', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(
      reply({ weaker: true, kind: 'announcement', yesTrigger: 'an announcement', fixedRules: ` ${FIXED} ` }),
    )

    const out = await checkRulesStrength(CLAIM, RULES)

    expect(out).toEqual({ verdict: 'weaker', kind: 'announcement', yesTrigger: 'an announcement', fixedRules: FIXED })
    expect(llmService.generateContent).toHaveBeenCalledTimes(1)
  })

  it('maps an unknown kind on a weaker verdict to other', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValueOnce(reply({ weaker: true, kind: 'surprise' }))

    expect((await checkRulesStrength(CLAIM, RULES)).kind).toBe('other')
  })

  it('fails open: a throwing or unparsable call returns verdict error', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValueOnce(new Error('boom'))
    expect((await checkRulesStrength(CLAIM, RULES)).verdict).toBe('error')

    vi.mocked(llmService.generateContent).mockResolvedValueOnce({ text: 'not json' } as never)
    expect((await checkRulesStrength(CLAIM, RULES)).verdict).toBe('error')
  })

  it('skips the call for empty rules', async () => {
    expect((await checkRulesStrength(CLAIM, '  ')).verdict).toBe('error')
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })
})
