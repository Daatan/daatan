import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GROUNDED_PANEL_MEMBERS, PANEL_MEMBERS, isControlModel, panelMemberLabel } from '../roster'

/** `{ region = ..., model = "..." }` entries of `local.panel_bedrock_models`. */
function grantedBedrockModels(): Set<string> {
  const tf = readFileSync(path.resolve(__dirname, '../../../../../terraform/bedrock_invoke.tf'), 'utf-8')
  const granted = new Set<string>()
  for (const [, region, model] of tf.matchAll(/\{\s*region\s*=\s*("[^"]+"|var\.aws_region)\s*,\s*model\s*=\s*"([^"]+)"\s*\}/g)) {
    granted.add(`${region === 'var.aws_region' ? 'default' : region.slice(1, -1)}|${model}`)
  }
  return granted
}

describe('roster', () => {
  // An ungranted member fails AccessDenied on every call and abstains forever, quietly.
  it('every Bedrock member is granted in terraform, in the region it is called in', () => {
    const granted = grantedBedrockModels()
    const bedrock = [...PANEL_MEMBERS, ...GROUNDED_PANEL_MEMBERS].filter((m) => m.route === 'bedrock')

    expect(bedrock.length).toBeGreaterThan(0)
    for (const m of bedrock) expect(granted).toContain(`${m.region ?? 'default'}|${m.model}`)
  })

  it('has exactly one control, and it is ungrounded', () => {
    const controls = PANEL_MEMBERS.filter((m) => m.control)
    expect(controls).toHaveLength(1)
    expect(controls[0].mode).toBe('ungrounded')
    expect(GROUNDED_PANEL_MEMBERS.some((m) => m.control)).toBe(false)
  })

  it('the current control and its retired predecessors are all controls; Gemini is not', () => {
    expect(isControlModel('google.gemma-3-4b-it')).toBe(true)
    expect(isControlModel('google/gemma-3-4b-it')).toBe(true)
    expect(isControlModel('google/gemini-3.5-flash-lite')).toBe(false)
    expect(isControlModel('deepseek.v3.2')).toBe(false)
  })
})

describe('panelMemberLabel', () => {
  it.each([
    ['qwen.qwen3-235b-a22b-2507-v1:0', 'Qwen'],
    ['deepseek.v3.2', 'DeepSeek'],
    ['deepseek/deepseek-chat', 'DeepSeek'],
    ['google.gemma-3-4b-it', 'Gemma'],
    ['google/gemma-3-4b-it', 'Gemma'],
    ['google/gemini-3.5-flash-lite', 'Gemini'],
    ['x-ai/grok-4.3', 'Grok'],
    ['global.xai.grok-4.7', 'Grok'],
    ['mistral.mistral-large-3-675b-instruct', 'Mistral'],
    ['openai/gpt-5-mini', 'GPT'],
  ])('%s → %s', (model, label) => {
    expect(panelMemberLabel(model)).toBe(label)
  })

  it('falls back to the raw id, so a new member is never unlabelled', () => {
    expect(panelMemberLabel('nvidia.nemotron-super-3-120b')).toBe('nvidia.nemotron-super-3-120b')
  })
})
