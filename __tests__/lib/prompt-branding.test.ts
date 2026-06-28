import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * LLM prompts are white-labelled: the {{appName}} placeholder is replaced with
 * the configured brand before the template leaves getPromptTemplate, so a
 * self-host's AI never says "DAATAN". For SaaS the brand is "DAATAN" — the
 * resolved text is byte-identical to the old literals.
 */

const brand = { name: 'DAATAN' }
vi.mock('@/lib/branding', () => ({ getAppName: () => brand.name }))

// Force the hardcoded-fallback path (no Bedrock/SSM in tests): make SSM reject.
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { send() { return Promise.reject(new Error('no ssm in test')) } },
  GetParameterCommand: class {},
}))
vi.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: class { send() { return Promise.reject(new Error('no bedrock')) } },
  GetPromptCommand: class {},
}))
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
