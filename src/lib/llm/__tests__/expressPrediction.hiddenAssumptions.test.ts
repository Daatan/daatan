import { describe, it, expect } from 'vitest'
import { PROMPTS } from '../bedrock-prompts'

// daatan#1744. generateExpressPrediction's LLM call is fully mocked in the other
// expressPrediction test files (bedrock-prompts itself is mocked out), so there is
// no way to pin "the model actually strips this assumption" without a live LLM —
// asserting against a canned mock response would just assert the mock's own return
// value. What IS real and checkable is that the instruction the model receives
// covers each hidden-assumption class from the issue's worked example (rotation
// agreements splitting one mandate between two PMs; a "four-year term" with no
// defined start or end point; resolution rules that only handle the obvious
// pathway to an outcome). Same pattern as untrustedInput.test.ts's direct
// PROMPTS[...] assertions.
const PROMPT = PROMPTS['express-prediction']

describe('express-prediction: rule 1a — hidden assumptions', () => {
  it('is present as rule 1a, between rule 1 and rule 2', () => {
    const rule1 = PROMPT.indexOf('\n1. ')
    const rule1a = PROMPT.indexOf('\n1a.')
    const rule2 = PROMPT.indexOf('\n2. ')
    expect(rule1, 'rule 1 not found').toBeGreaterThan(-1)
    expect(rule1a, 'rule 1a not found').toBeGreaterThan(rule1)
    expect(rule2, 'rule 2 not found').toBeGreaterThan(rule1a)
  })

  it('tells the model to surface an unstated premise treated as certain', () => {
    // Worked example: "the October 27, 2026 Knesset elections" asserted as
    // settled fact rather than as a condition on the election actually happening.
    expect(PROMPT).toMatch(/unstated premise treated as certain/i)
  })

  it('tells the model to check for an implied single actor/outcome (rotation-agreement case)', () => {
    // Worked example: Bennett–Lapid 2021-22 split one electoral mandate between
    // two PMs — "elected in the elections" implies a single, unambiguous winner.
    expect(PROMPT).toMatch(/implied single actor\/outcome/i)
    expect(PROMPT).toMatch(/coalition\/rotation uncertainty/i)
  })

  it('tells the model to check for an undefined start or end point (duration case)', () => {
    // Worked example: "a full four-year term" names no start point (swearing-in
    // vs. election date) and no end date.
    expect(PROMPT).toMatch(/undefined start or end point for any duration/i)
  })

  it('tells the model resolution rules must cover every plausible pathway, not just the obvious one', () => {
    // Worked example: "serve less than" a term doesn't say which mechanism
    // counts — resignation, no-confidence vote, death, dissolution, rotation.
    expect(PROMPT).toMatch(/resignation vs\. no-confidence vote vs\. death vs\. dissolution/i)
  })
})
