'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Check, Loader2 } from 'lucide-react'
import { locales, localeLabels, type Locale } from '@/i18n/config'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('LanguagePicker')

interface LanguagePickerProps {
  currentLocale: string
}

// Set cookie for server-side locale detection
const setLocaleCookie = (locale: Locale) => {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;samesite=lax`
}

export const LanguagePicker = ({ currentLocale }: LanguagePickerProps) => {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Locale>(currentLocale as Locale)

  const handleChangeLocale = async (locale: Locale) => {
    if (locale === selected) return

    setSelected(locale)

    try {
      setLocaleCookie(locale)

      // Save preference to user profile (if authenticated)
      await fetch('/api/profile/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale }),
      }).catch(() => {
        // Non-blocking: cookie is the primary mechanism
      })

      startTransition(() => {
        router.refresh()
      })
    } catch (error) {
      log.error({ err: error }, 'Failed to change language')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
        <Globe className="w-4 h-4" />
        <span>Language</span>
        {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {locales.map((locale) => (
          <button
            key={locale}
            onClick={() => handleChangeLocale(locale)}
            disabled={isPending}
            className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
              selected === locale
                ? 'border-blue-500 bg-cobalt/10 text-cobalt-light'
                : 'border-navy-600 bg-navy-700 text-text-secondary hover:border-gray-300 hover:bg-navy-800'
            }`}
            aria-label={`Switch to ${localeLabels[locale]}`}
          >
            <span>{localeLabels[locale]}</span>
            {selected === locale && <Check className="w-4 h-4 text-blue-500" />}
          </button>
        ))}
      </div>
    </div>
  )
}
