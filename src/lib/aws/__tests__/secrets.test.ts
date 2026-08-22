import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted: the mock factory is hoisted above module-level consts, and secrets.ts
// constructs its SSMClient at import time.
const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = send
  },
  GetParametersCommand: class {
    constructor(public input: unknown) {}
  },
}))

import {
  AWS_SECRET_NAMES,
  SHARED_SECRET_NAMES,
  getAwsSecret,
  warmAwsSecrets,
  __resetAwsSecretsCache,
} from '../secrets'

const OLD_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  __resetAwsSecretsCache()
  process.env.APP_ENV = 'staging'
})
afterEach(() => {
  process.env = { ...OLD_ENV }
})

function param(name: string, value: string) {
  return { Name: `/daatan/staging/secrets/${name}`, Value: value }
}

function sharedParam(name: string, value: string) {
  return { Name: `/daatan/shared/secrets/${name}`, Value: value }
}

describe('warmAwsSecrets', () => {
  it('requests every declared secret, decrypted, in one call', async () => {
    send.mockResolvedValue({ Parameters: [] })

    await warmAwsSecrets()

    const { input } = send.mock.calls[0][0]
    expect(input.WithDecryption).toBe(true)
    expect(input.Names).toEqual([
      ...AWS_SECRET_NAMES.map((n) => `/daatan/staging/secrets/${n}`),
      ...SHARED_SECRET_NAMES.map((n) => `/daatan/shared/secrets/${n}`),
    ])
  })

  it('reads a shared secret off the env-independent /daatan/shared/secrets/ path', async () => {
    send.mockResolvedValue({ Parameters: [sharedParam('ORACLE_API_KEY', 'oracle-secret')] })

    await warmAwsSecrets()

    expect(getAwsSecret('ORACLE_API_KEY')).toBe('oracle-secret')
  })

  it("a shared secret's path does not vary with APP_ENV", async () => {
    process.env.APP_ENV = 'production'
    send.mockResolvedValue({ Parameters: [] })

    await warmAwsSecrets()

    expect(send.mock.calls[0][0].input.Names).toContain('/daatan/shared/secrets/ORACLE_API_KEY')
  })

  it('caches a fetched value for sync reads', async () => {
    send.mockResolvedValue({ Parameters: [param('OPENROUTER_API_KEY', 'sk-or-live')] })

    await warmAwsSecrets()

    expect(getAwsSecret('OPENROUTER_API_KEY')).toBe('sk-or-live')
  })

  // Terraform creates the parameter at PLACEHOLDER before a human sets it. That must read
  // as "not configured" so callers fall through to env, not as a literal API key.
  it('treats PLACEHOLDER as absent', async () => {
    send.mockResolvedValue({ Parameters: [param('OPENROUTER_API_KEY', 'PLACEHOLDER')] })

    await warmAwsSecrets()

    expect(getAwsSecret('OPENROUTER_API_KEY')).toBe('')
  })

  it('returns empty for a parameter SSM reports as invalid/missing', async () => {
    send.mockResolvedValue({
      Parameters: [],
      InvalidParameters: ['/daatan/staging/secrets/OPENROUTER_API_KEY'],
    })

    await warmAwsSecrets()

    expect(getAwsSecret('OPENROUTER_API_KEY')).toBe('')
  })

  // No SSM, no parameter, no kms:Decrypt — none of these may take the app down. They all
  // degrade to the env-var fallback that existed before this module.
  it('never throws when SSM fails', async () => {
    send.mockRejectedValue(new Error('AccessDeniedException: kms:Decrypt'))

    await expect(warmAwsSecrets()).resolves.toBeUndefined()
    expect(getAwsSecret('OPENROUTER_API_KEY')).toBe('')
  })

  it('caches for 5 minutes rather than calling SSM per read', async () => {
    send.mockResolvedValue({ Parameters: [param('OPENROUTER_API_KEY', 'sk-or-live')] })

    await warmAwsSecrets()
    await warmAwsSecrets()
    await warmAwsSecrets()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('force=true bypasses the cache', async () => {
    send.mockResolvedValue({ Parameters: [param('OPENROUTER_API_KEY', 'a')] })
    await warmAwsSecrets()
    send.mockResolvedValue({ Parameters: [param('OPENROUTER_API_KEY', 'b')] })

    await warmAwsSecrets(true)

    expect(getAwsSecret('OPENROUTER_API_KEY')).toBe('b')
  })

  it('shares one in-flight request across concurrent callers', async () => {
    let resolve!: (v: unknown) => void
    send.mockReturnValue(new Promise((r) => (resolve = r)))

    const all = Promise.all([warmAwsSecrets(), warmAwsSecrets(), warmAwsSecrets()])
    resolve({ Parameters: [param('OPENROUTER_API_KEY', 'sk')] })
    await all

    // A 57-forecast sweep must not make 57 GetParameters calls.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reads prod paths when APP_ENV=production', async () => {
    process.env.APP_ENV = 'production'
    send.mockResolvedValue({ Parameters: [] })

    await warmAwsSecrets()

    expect(send.mock.calls[0][0].input.Names[0]).toBe('/daatan/prod/secrets/OPENROUTER_API_KEY')
  })

  it('the NEXT preview environment shares staging parameters', async () => {
    process.env.APP_ENV = 'next'
    send.mockResolvedValue({ Parameters: [] })

    await warmAwsSecrets()

    expect(send.mock.calls[0][0].input.Names[0]).toBe(
      '/daatan/staging/secrets/OPENROUTER_API_KEY',
    )
  })
})
