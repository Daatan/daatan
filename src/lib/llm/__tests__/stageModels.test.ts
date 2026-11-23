import { afterEach, describe, expect, it } from 'vitest'
import { forStage, parseStageModels, stageModel, stageModelSource } from '../stageModels'

describe('forStage / stageModel read the model registry (daatan#2287)', () => {
  it('fills model, params and timeout from the stage entry', () => {
    expect(forStage('moderation')).toEqual({ stage: 'moderation', temperature: 0 })
    expect(forStage('express_draft')).toEqual({ stage: 'express_draft', temperature: 0.2, thinkingBudget: 512 })
    expect(forStage('search_query')).toEqual({ stage: 'search_query', temperature: 0, thinkingBudget: 0 })
    expect(forStage('research_verdict')).toEqual({
      stage: 'research_verdict',
      model: 'gemini-2.5-pro',
      temperature: 0,
      googleTimeoutMs: 75_000,
    })
  })

  it("a stage without its own primary runs on the chain's Google model", () => {
    expect(stageModel('moderation')).toBe('gemini-2.5-flash')
    expect(stageModel('research_verdict')).toBe('gemini-2.5-pro')
    expect(stageModelSource('moderation')).toBe('registry')
  })
})

describe('LLM_STAGE_MODELS (#1800) still wins until the registry is verified', () => {
  afterEach(() => {
    delete process.env.LLM_STAGE_MODELS
  })

  it('moves one stage without touching the others', () => {
    process.env.LLM_STAGE_MODELS = 'moderation=gemini-2.5-flash-lite, research_verdict = gemini-3.8-flash'
    expect(forStage('moderation')).toEqual({ stage: 'moderation', model: 'gemini-2.5-flash-lite', temperature: 0 })
    expect(forStage('guess_chances')).toEqual({ stage: 'guess_chances', temperature: 0 })
    expect(stageModel('research_verdict')).toBe('gemini-3.8-flash')
    expect(stageModelSource('moderation')).toBe('env')
  })

  it('ignores unknown stages and malformed pairs', () => {
    expect(parseStageModels('nope=x,moderation,=y,tags=gemini-x')).toEqual({ tags: 'gemini-x' })
  })
})
