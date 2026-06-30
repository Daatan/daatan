import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-middleware'
import { isSelfHosted } from '@/lib/edition'
import {
  SETTING_KEYS,
  loadSettings,
  setSetting,
  getCachedSetting,
  getOpenRouterKey,
} from '@/lib/services/settings'
import { rebuildLlmService } from '@/lib/llm'
import { handleRouteError, apiError } from '@/lib/api-error'

/**
 * Admin-editable runtime settings (self_hosted only). The OpenRouter key is a
 * secret: it is NEVER returned by GET (only `{ configured }`), and a blank/
 * omitted key on save keeps the existing one — clearing requires an explicit
 * flag. Non-secret fields revert to the env/default when saved blank.
 */

export const GET = withAuth(async () => {
  if (!isSelfHosted()) return apiError('Not found', 404)
  await loadSettings()
  return NextResponse.json({
    appName: getCachedSetting(SETTING_KEYS.appName) ?? '',
    appLogoUrl: getCachedSetting(SETTING_KEYS.appLogoUrl) ?? '',
    aboutTitle: getCachedSetting(SETTING_KEYS.aboutTitle) ?? '',
    aboutBody: getCachedSetting(SETTING_KEYS.aboutBody) ?? '',
    openrouterModel: getCachedSetting(SETTING_KEYS.openrouterModel) ?? '',
    // Secret: presence only, never the value.
    openrouterKeyConfigured: !!getOpenRouterKey(),
  })
}, { roles: ['ADMIN'] })

// Logo lands in <img src> / og:image / favicon, so constrain it to a relative
// path or an http(s) URL (empty reverts to the bundled asset).
const logoUrl = z
  .string()
  .max(500)
  .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), {
    message: 'Logo URL must be a relative path or an http(s) URL',
  })

const bodySchema = z.object({
  appName: z.string().max(100).optional(),
  appLogoUrl: logoUrl.optional(),
  aboutTitle: z.string().max(200).optional(),
  aboutBody: z.string().max(20000).optional(),
  openrouterModel: z.string().max(100).optional(),
  // Secret. A blank/omitted value keeps the existing key; set clearOpenrouterKey
  // to remove it.
  openrouterKey: z.string().max(400).optional(),
  clearOpenrouterKey: z.boolean().optional(),
})

export const PUT = withAuth(async (req) => {
  if (!isSelfHosted()) return apiError('Not found', 404)
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return apiError('Invalid settings payload', 400)
    const b = parsed.data

    // Non-secret fields: a provided string is authoritative (empty reverts to
    // the env/default by deleting the row).
    if (typeof b.appName === 'string') await setSetting(SETTING_KEYS.appName, b.appName)
    if (typeof b.appLogoUrl === 'string') await setSetting(SETTING_KEYS.appLogoUrl, b.appLogoUrl)
    if (typeof b.aboutTitle === 'string') await setSetting(SETTING_KEYS.aboutTitle, b.aboutTitle)
    if (typeof b.aboutBody === 'string') await setSetting(SETTING_KEYS.aboutBody, b.aboutBody)
    if (typeof b.openrouterModel === 'string') await setSetting(SETTING_KEYS.openrouterModel, b.openrouterModel)

    // Secret: explicit clear, or set only when a non-blank value is supplied.
    let llmChanged = false
    if (b.clearOpenrouterKey === true) {
      await setSetting(SETTING_KEYS.openrouterApiKey, '')
      llmChanged = true
    } else if (typeof b.openrouterKey === 'string' && b.openrouterKey.trim() !== '') {
      await setSetting(SETTING_KEYS.openrouterApiKey, b.openrouterKey)
      llmChanged = true
    }
    // Rebuild the LLM service so a key/model change takes effect with no restart.
    if (llmChanged || typeof b.openrouterModel === 'string') rebuildLlmService()

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleRouteError(err, 'Failed to update settings')
  }
}, { roles: ['ADMIN'] })
