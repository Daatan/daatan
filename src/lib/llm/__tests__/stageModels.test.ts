import { afterEach, describe, expect, it } from 'vitest'
import { forStage, parseStageModels, stageModel } from '../stageModels'

describe('LLM_STAGE_MODELS (#1800)', () => {
  afterEach(() => {
    delete process.env.LLM_STAGE_MODELS
  })

  it('unset leaves every stage on the chain default', () => {
    expect(forStage('moderation')).toEqual({ stage: 'moderation' })
    expect(stageModel('research_verdict', 'gemini-2.5-pro')).toBe('gemini-2.5-pro')
  })

  it('moves one stage without touching the others', () => {
    process.env.LLM_STAGE_MODELS = 'moderation=gemini-2.5-flash-lite, research_verdict = gemini-3.8-flash'
    expect(forStage('moderation')).toEqual({ stage: 'moderation', model: 'gemini-2.5-flash-lite' })
    expect(forStage('guess_chances')).toEqual({ stage: 'guess_chances' })
    expect(stageModel('research_verdict', 'gemini-2.5-pro')).toBe('gemini-3.8-flash')
  })

  it('ignores unknown stages and malformed pairs', () => {
    expect(parseStageModels('nope=x,moderation,=y,tags=gemini-x')).toEqual({ tags: 'gemini-x' })
  })
})
