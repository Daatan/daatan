import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { isSelfHosted } from '@/lib/edition'
import { createLogger } from '@/lib/logger'

const log = createLogger('settings')

/**
 * Admin-editable runtime settings for the self_hosted edition.
 *
 * A DB row OVERRIDES the matching .env value; with no row the env (or a
 * hardcoded default) is used. The cache is warmed once at boot
 * (instrumentation) and kept fresh write-through on every {@link setSetting}.
 * Reads are synchronous against the in-memory cache so the existing
 * branding/capabilities getters keep their signatures.
 *
 * SaaS NEVER warms the cache and its getters never consult it (they short-
 * circuit on edition first), so the SaaS deploy is byte-identical to before.
 */

export const SETTING_KEYS = {
  appName: 'app_name',
  appLogoUrl: 'app_logo_url',
  aboutTitle: 'app_about_title',
  aboutBody: 'app_about_body',
  openrouterApiKey: 'openrouter_api_key',
  openrouterModel: 'openrouter_model',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

let cache = new Map<string, string>()
let warmed = false

/** Synchronous read of a cached setting, or undefined when unset/unwarmed. */
export function getCachedSetting(key: SettingKey): string | undefined {
  return cache.get(key)
}

/**
 * Load all settings into the cache. No-op (and never touches the DB) outside
 * the self_hosted edition. Safe to call repeatedly.
 *
 * The freshly-loaded map is swapped in atomically (built fully, then assigned)
 * so a concurrent {@link getCachedSetting} can never observe an empty/partial
 * cache — readers see either the old map or the new one, never a torn state.
 */
export async function loadSettings(): Promise<void> {
  if (!isSelfHosted()) return
  try {
    const rows = await prisma.setting.findMany()
    const next = new Map<string, string>()
    for (const row of rows) next.set(row.key, row.value)
    cache = next
    warmed = true
    log.info({ count: rows.length }, 'settings loaded')
  } catch (err) {
    log.error({ err }, 'failed to load settings — using env fallbacks')
  }
}

/**
 * Warm the cache from the DB once, lazily — for request paths (e.g. /about)
 * that can await but shouldn't pay a DB round-trip on every hit. After the boot
 * warm or the first call this is a no-op; write-through keeps it fresh in-process.
 */
export async function ensureSettingsWarmed(): Promise<void> {
  if (warmed || !isSelfHosted()) return
  await loadSettings()
}

/**
 * Upsert a setting and update the cache write-through. An empty/whitespace
 * value deletes the row (reverting to the env/default). self_hosted only.
 */
export async function setSetting(key: SettingKey, value: string): Promise<void> {
  if (!isSelfHosted()) {
    throw new Error('Settings are editable only in the self_hosted edition')
  }
  const trimmed = value.trim()
  // Write errors are rethrown sanitized: a raw Prisma error can echo the
  // offending value (here possibly the OpenRouter key) into logs / staging
  // error bodies — that one value must never leak.
  try {
    if (trimmed === '') {
      await prisma.setting.deleteMany({ where: { key } })
      const next = new Map(cache)
      next.delete(key)
      cache = next
      return
    }
    await prisma.setting.upsert({
      where: { key },
      update: { value: trimmed },
      create: { key, value: trimmed },
    })
    // Mutate a copy then swap, mirroring loadSettings' atomic-swap contract.
    const next = new Map(cache)
    next.set(key, trimmed)
    cache = next
  } catch {
    throw new Error(`Failed to persist setting "${key}"`)
  }
}

/** Whether the cache has been warmed from the DB at least once. */
export function settingsWarmed(): boolean {
  return warmed
}

/** The effective OpenRouter API key: admin-set (DB) → env. */
export function getOpenRouterKey(): string {
  return getCachedSetting(SETTING_KEYS.openrouterApiKey) || env.OPENROUTER_API_KEY || ''
}

/** The effective OpenRouter model: admin-set (DB) → env → default. */
export function getOpenRouterModel(): string {
  return (
    getCachedSetting(SETTING_KEYS.openrouterModel) ||
    env.OPENROUTER_MODEL ||
    'openai/gpt-4o-mini'
  )
}
