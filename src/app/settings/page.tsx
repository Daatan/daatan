'use client'

import { Settings } from 'lucide-react'
import { redirect } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { LanguagePicker } from '@/components/LanguagePicker'
import AiPanelPreference from '@/components/settings/AiPanelPreference'
import NotificationPreferences from '@/components/settings/NotificationPreferences'
import DeleteAccountSection from '@/components/settings/DeleteAccountSection'
import ForgetHistorySection from '@/components/settings/ForgetHistorySection'

export default function SettingsPage() {
  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect('/auth/signin?callbackUrl=/settings')
    },
  })

  const locale = useLocale()
  const t = useTranslations('settings')
  const c = useTranslations('common')

  if (status === 'loading') {
    return <div className="p-8 text-center">{c('loading')}</div>
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Settings className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white mb-1">{t('preferences')}</h2>
          <p className="text-sm text-gray-500">{t('preferencesDescription')}</p>
        </div>

        <div className="p-6 space-y-6">
          <LanguagePicker currentLocale={locale} />
          <AiPanelPreference />
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mt-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white mb-1">{t('notifications')}</h2>
          <p className="text-sm text-gray-500">{t('notificationsDescription')}</p>
        </div>

        <div className="p-6">
          <NotificationPreferences />
        </div>
      </div>

      <div className="bg-navy-700 border border-red-900/50 rounded-xl shadow-sm overflow-hidden mt-6">
        <div className="p-6 border-b border-red-900/50">
          <h2 className="text-lg font-semibold text-red-400 mb-1">{t('dangerZone')}</h2>
          <p className="text-sm text-gray-500">{t('dangerZoneDescription')}</p>
        </div>
        <div className="divide-y divide-red-900/50">
          <ForgetHistorySection />
          <DeleteAccountSection />
        </div>
      </div>
    </div>
  )
}
