import { describe, it, expect } from 'vitest'
import { PROMPTS } from '../bedrock-prompts'

// daatan#2166. Live case cmnt0epr6004idh511bp2kfgq ("Likud will win the next general
// election in Israel"), rules: "Resolved as 'Yes' if Likud forms the governing coalition
// … If no single party forms a government, 'Yes' if Likud is the largest party." In
// Israel no party forms a government alone, so the fallback always applied: the
// resolver read "largest party", the extractor read "forms the coalition".
// The model's behaviour is measured live by scripts/check-express-coalition-fallback.ts;
// here we pin that the instruction is in the prompt it receives (same pattern as
// expressPrediction.hiddenAssumptions.test.ts).
const PROMPT = PROMPTS['express-prediction']

describe('express-prediction: rule 9c — no always-true fallback in coalition elections', () => {
  it('is present as rule 9c, between rule 9b and rule 10', () => {
    const r9b = PROMPT.indexOf('\n9b.')
    const r9c = PROMPT.indexOf('\n9c.')
    const r10 = PROMPT.indexOf('\n10. ')
    expect(r9b, 'rule 9b not found').toBeGreaterThan(-1)
    expect(r9c, 'rule 9c not found').toBeGreaterThan(r9b)
    expect(r10, 'rule 10 not found').toBeGreaterThan(r9c)
  })

  it('names the ambiguous fallback it forbids', () => {
    expect(PROMPT).toMatch(/if no single party forms a government/i)
    expect(PROMPT).toMatch(/Never write a fallback whose condition is always met/i)
  })

  it('makes the rules pick one criterion: most seats, or the leader sworn in as PM', () => {
    expect(PROMPT).toMatch(/most seats in the official final results/i)
    expect(PROMPT).toMatch(/sworn in as Prime Minister/i)
    expect(PROMPT).toMatch(/a bare "win the election" is \(a\)/i)
  })

  it('binds any no-government fallback to a date with a stated outcome', () => {
    expect(PROMPT).toMatch(/If no government is sworn in by <date>, resolves NO\./)
  })
})
