import { describe, it, expect } from 'vitest'
import { PROMPTS } from '../bedrock-prompts'

// daatan#2166. Live case cmnt0epr6004idh511bp2kfgq ("Likud will win the next general
// election in Israel"): the rules read "win" as forming the coalition, with an always-true
// fallback to "largest party", and the resolver and extractor settled it differently. Rule 9c
// is the general form: a term with two common readings is resolved in the claim text, where
// the author sees it, never quietly in the rules. The claim-definedness judge
// (claimDefinedness.ts) checks the result; scripts/check-claim-definedness.ts measures both.
const PROMPT = PROMPTS['express-prediction']

describe('express-prediction: rule 9c — well-defined claim', () => {
  it('is present as rule 9c, between rule 9b and rule 10', () => {
    const r9b = PROMPT.indexOf('\n9b.')
    const r9c = PROMPT.indexOf('\n9c. **Well-defined claim.**')
    const r10 = PROMPT.indexOf('\n10. ')
    expect(r9b, 'rule 9b not found').toBeGreaterThan(-1)
    expect(r9c, 'rule 9c not found').toBeGreaterThan(r9b)
    expect(r10, 'rule 10 not found').toBeGreaterThan(r9c)
  })

  it('puts the chosen reading into the claim text instead of settling it quietly in the rules', () => {
    expect(PROMPT).toMatch(/do not settle it quietly in the rules: write the reading you chose into the claim text itself/)
  })

  it('forbids a fallback whose condition always holds', () => {
    expect(PROMPT).toMatch(/never through a fallback whose condition always holds/)
  })

  it('is general, not a list of coalition countries', () => {
    expect(PROMPT).not.toMatch(/Belgium, Denmark/)
  })
})
