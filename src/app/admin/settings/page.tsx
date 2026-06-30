import { redirect } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import SettingsPanel from '../SettingsPanel'

/**
 * Admin → Settings: runtime config for the self_hosted edition (brand name,
 * /about content, OpenRouter key). The feature doesn't exist on SaaS, so the
 * route redirects there.
 */
export default function AdminSettingsPage() {
  if (!isSelfHosted()) redirect('/admin/forecasts')
  return <SettingsPanel />
}
