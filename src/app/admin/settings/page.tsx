import { redirect } from 'next/navigation'
import { env } from '@/env'
import SettingsPanel from '../SettingsPanel'

/**
 * Admin → Settings: runtime config for the self_hosted edition (brand name,
 * /about content, OpenRouter key). The feature doesn't exist on SaaS, so the
 * route redirects there.
 */
export default function AdminSettingsPage() {
  if (env.DAATAN_EDITION !== 'self_hosted') redirect('/admin/forecasts')
  return <SettingsPanel />
}
