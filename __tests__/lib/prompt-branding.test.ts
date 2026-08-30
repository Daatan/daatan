import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * LLM prompts are white-labelled: the {{appName}} placeholder is replaced with
 * the configured brand before the template leaves getPromptTemplate, so a
 * self-host's AI never says "DAATAN". For SaaS the brand is "DAATAN" — the
 * resolved text is byte-identical to the old literals.
 */

const brand = { name: 'DAATAN' }
vi.mock('@/lib/branding', () => ({ getAppName: () => brand.name }))

// These used to mock @aws-sdk/client-ssm and @aws-sdk/client-bedrock-agent into rejecting,
// to force the hardcoded-fallback path. #1658 deleted the fetch, so there is no path to
// force and no fallback to fall back to — getPromptTemplate is a lookup in PROMPTS. The
// bedrock-agent package is not even a dependency any more.
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('prompt white-labelling', () => {
  beforeEach(() => { brand.name = 'DAATAN'; vi.resetModules() })

  it('substitutes {{appName}} with the configured brand and leaves no placeholder', async () => {
    brand.name = 'Acme Forecasting'
    const { getPromptTemplate } = await import('@/lib/llm/bedrock-prompts')
    const t = await getPromptTemplate('express-prediction')
    expect(t).toContain('Acme Forecasting')
    expect(t).not.toContain('{{appName}}')
    expect(t).not.toContain('DAATAN')
  })

  it('resolves to DAATAN for SaaS (byte-identical to the old literal)', async () => {
    const { getPromptTemplate } = await import('@/lib/llm/bedrock-prompts')
    const t = await getPromptTemplate('express-prediction')
    expect(t).toContain('prediction assistant for DAATAN')
    expect(t).not.toContain('{{appName}}')
  })
})
