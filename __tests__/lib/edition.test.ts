import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

async function load() {
  vi.resetModules()
  return import('@/lib/edition')
}

describe('edition', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
  })

  it('isSelfHosted is true only for DAATAN_EDITION=self_hosted', async () => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
    expect((await load()).isSelfHosted()).toBe(true)
  })

  it('treats saas and unset (SKIP_ENV_VALIDATION) as NOT self-hosted', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    expect((await load()).isSelfHosted()).toBe(false)
    delete mockEnv.DAATAN_EDITION
    expect((await load()).isSelfHosted()).toBe(false)
  })
})
