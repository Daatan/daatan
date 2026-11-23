import { describe, expect, it } from 'vitest'
import { applyQuirks, RejectedParamError, type QuirkTable } from '../quirks'
import { normalizeModelId } from '../registry'
import { withModelQuirks } from '../service'
import type { LLMProvider } from '../types'

const TABLE: QuirkTable = {
  'vendor.no-temp': { temperature: { rule: 'ignore', note: 'answers 400 to temperature' } },
  'vendor.never': { reasoningBudget: { rule: 'reject', note: 'reasons always' } },
  'vendor.renamed': { reasoningBudget: { rule: 'rename', to: 'maxTokens', note: 'budget is the output cap' } },
  'vendor.hooked': { temperature: { rule: 'hook', hook: 'halve', note: 'scale is 0..1' } },
}
const HOOKS = { halve: (p: { temperature?: number }) => ({ ...p, temperature: (p.temperature ?? 0) / 2 }) }

describe('applyQuirks (daatan#2287)', () => {
  it('returns the same object when the model has no quirk', () => {
    const params = { temperature: 0 }
    expect(applyQuirks('vendor.plain', params, [], TABLE, HOOKS)).toBe(params)
  })

  it('ignore drops the param, force keeps it', () => {
    expect(applyQuirks('vendor.no-temp', { temperature: 0, maxTokens: 64 }, [], TABLE, HOOKS)).toEqual({ maxTokens: 64 })
    expect(applyQuirks('vendor.no-temp', { temperature: 0 }, ['temperature'], TABLE, HOOKS)).toEqual({ temperature: 0 })
  })

  it('a rule only fires when the param is set', () => {
    const params = { maxTokens: 64 }
    expect(applyQuirks('vendor.no-temp', params, [], TABLE, HOOKS)).toBe(params)
  })

  it('reject throws, forced or not', () => {
    expect(() => applyQuirks('vendor.never', { reasoningBudget: 0 }, [], TABLE, HOOKS)).toThrow(RejectedParamError)
    expect(() => applyQuirks('vendor.never', { reasoningBudget: 0 }, ['reasoningBudget'], TABLE, HOOKS)).toThrow(/reasons always/)
  })

  it('rename sends the value as another param', () => {
    expect(applyQuirks('vendor.renamed', { reasoningBudget: 32 }, [], TABLE, HOOKS)).toEqual({ maxTokens: 32 })
  })

  it('hook runs the named function', () => {
    expect(applyQuirks('vendor.hooked', { temperature: 0.4 }, [], TABLE, HOOKS)).toEqual({ temperature: 0.2 })
  })

  it('matches every route to the same model', () => {
    expect(normalizeModelId('bedrock/us.anthropic.claude-sonnet-5-5')).toBe('anthropic.claude-sonnet-5-5')
    expect(normalizeModelId('global.xai.grok-4.7')).toBe('xai.grok-4.7')
    expect(normalizeModelId('google/gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite')
    expect(normalizeModelId('deepseek.v3.2')).toBe('deepseek.v3.2')
  })

  it('the registry quirk for Bedrock Grok drops temperature on every route', () => {
    expect(applyQuirks('global.xai.grok-4.7', { temperature: 0, maxTokens: 64 })).toEqual({ maxTokens: 64 })
  })
})

describe('withModelQuirks — per chain leg', () => {
  const leg = (model: string): LLMProvider => ({ name: 'test', modelFor: () => model, generateContent: async () => ({ text: '' }) })

  it("applies the leg's model quirks to the request", () => {
    const req = { prompt: 'p', temperature: 0, stage: 'moderation' as const }
    expect(withModelQuirks(leg('xai.grok-4.7'), req)).toEqual({ prompt: 'p', stage: 'moderation' })
    expect(withModelQuirks(leg('gemini-2.5-flash'), req)).toBe(req)
  })

  it('keeps a forced param', () => {
    const req = { prompt: 'p', temperature: 0, forceParams: ['temperature' as const] }
    expect(withModelQuirks(leg('xai.grok-4.7'), req)).toBe(req)
  })

  it('leaves a provider without modelFor alone', () => {
    const req = { prompt: 'p', temperature: 0 }
    expect(withModelQuirks({ name: 'double', generateContent: async () => ({ text: '' }) }, req)).toBe(req)
  })
})
