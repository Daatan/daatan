'use client'

import { useTranslations } from 'next-intl'
import { COOKIE_SETTINGS_EVENT } from '@/components/CookieConsent'

/** Re-opens the consent banner so a visitor can change or withdraw their analytics choice. */
export default function CookieSettingsLink({ className }: { className?: string }) {
  const t = useTranslations('footer')
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}
    >
      {t('cookieSettings')}
    </button>
  )
}
