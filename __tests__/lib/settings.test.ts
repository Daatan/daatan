import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Admin-editable runtime settings. A DB row overrides env; the cache is read
 * synchronously. self_hosted only — SaaS never warms or writes, so its getters
 * (which short-circuit on edition elsewhere) never see a row.
 */

const mockEnv: Record<string, unknown> = {}
vi.mock('@/env', () => ({ env: mockEnv }))

const db = {
  rows: [] as Array<{ key: string; value: string }>,
  findMany: vi.fn(async () => db.rows),
  upsert: vi.fn(async (_a?: unknown) => undefined),
  deleteMany: vi.fn(async (_a?: unknown) => ({ count: 1 })),
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    setting: {
      findMany: () => db.findMany(),
      upsert: (a: unknown) => db.upsert(a),
      deleteMany: (a: unknown) => db.deleteMany(a),
    },
  },
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

async function load() {
  vi.resetModules()
  return import('@/lib/services/settings')
}

beforeEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k]
  db.rows = []
  db.findMany.mockClear()
  db.upsert.mockClear()
  db.deleteMany.mockClear()
})

describe('settings — edition gating', () => {
  it('loadSettings is a no-op (and never queries) outside self_hosted', async () => {
    const s = await load()
    await s.loadSettings()
    expect(db.findMany).not.toHaveBeenCalled()
    expect(s.settingsWarmed()).toBe(false)
    expect(s.getCachedSetting(s.SETTING_KEYS.appName)).toBeUndefined()
  })

  it('setSetting refuses to write outside self_hosted', async () => {
    const s = await load()
    await expect(s.setSetting(s.SETTING_KEYS.appName, 'Acme')).rejects.toThrow(/self_hosted/)
    expect(db.upsert).not.toHaveBeenCalled()
  })
})

describe('settings — self_hosted', () => {
  beforeEach(() => {
    mockEnv.DAATAN_EDITION = 'self_hosted'
  })

  it('warms the cache from the DB and reads synchronously', async () => {
    db.rows = [{ key: 'app_name', value: 'Acme' }]
    const s = await load()
    await s.loadSettings()
    expect(s.settingsWarmed()).toBe(true)
    expect(s.getCachedSetting(s.SETTING_KEYS.appName)).toBe('Acme')
  })

  it('setSetting upserts and updates the cache write-through', async () => {
    const s = await load()
    await s.setSetting(s.SETTING_KEYS.appName, '  Acme  ')
    expect(db.upsert).toHaveBeenCalledWith({
      where: { key: 'app_name' },
      update: { value: 'Acme' },
      create: { key: 'app_name', value: 'Acme' },
    })
    expect(s.getCachedSetting(s.SETTING_KEYS.appName)).toBe('Acme') // trimmed
  })

  it('setSetting with a blank value deletes the row (revert to env/default)', async () => {
    const s = await load()
    await s.setSetting(s.SETTING_KEYS.appName, '   ')
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { key: 'app_name' } })
    expect(db.upsert).not.toHaveBeenCalled()
    expect(s.getCachedSetting(s.SETTING_KEYS.appName)).toBeUndefined()
  })

  it('getOpenRouterKey: DB setting > env > empty', async () => {
    const s = await load()
    expect(s.getOpenRouterKey()).toBe('')
    mockEnv.OPENROUTER_API_KEY = 'env-key'
    expect(s.getOpenRouterKey()).toBe('env-key')
    await s.setSetting(s.SETTING_KEYS.openrouterApiKey, 'db-key')
    expect(s.getOpenRouterKey()).toBe('db-key')
  })

  it('getOpenRouterModel: DB setting > env > default', async () => {
    const s = await load()
    expect(s.getOpenRouterModel()).toBe('openai/gpt-4o-mini')
    mockEnv.OPENROUTER_MODEL = 'env/model'
    expect(s.getOpenRouterModel()).toBe('env/model')
    await s.setSetting(s.SETTING_KEYS.openrouterModel, 'db/model')
    expect(s.getOpenRouterModel()).toBe('db/model')
  })
})
