'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, Loader2, BellOff, BellRing } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslations } from 'next-intl'
import { usePushSubscription } from '@/lib/hooks/usePushSubscription'
import type { NotificationType } from '@prisma/client'
import { Button } from '@/components/ui/Button'

interface Preference {
  type: NotificationType
  inApp: boolean
  email: boolean
  browserPush: boolean
}

const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
  COMMITMENT_RESOLVED: 'commitmentResolved',
  COMMENT_ON_FORECAST: 'commentOnForecast',
  REPLY_TO_COMMENT: 'replyToComment',
  NEW_COMMITMENT: 'newCommitment',
  MENTION: 'mention',
  SYSTEM: 'systemAnnouncements',
}

export default function NotificationPreferences() {
  const t = useTranslations('settings')
  const [preferences, setPreferences] = useState<Preference[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const { isSupported, permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushSubscription()
  const [pushWorking, setPushWorking] = useState(false)

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/preferences')
      if (res.ok) {
        const data = await res.json()
        setPreferences(data.preferences)
      } else {
        toast.error(t('prefsLoadError'))
      }
    } catch {
      toast.error(t('prefsLoadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchPreferences()
  }, [fetchPreferences])

  const togglePreference = async (type: NotificationType, channel: 'inApp' | 'browserPush') => {
    const pref = preferences.find((p) => p.type === type)
    if (!pref) return

    const newValue = !pref[channel]

    // Optimistic update
    setPreferences((prev) =>
      prev.map((p) => (p.type === type ? { ...p, [channel]: newValue } : p)),
    )

    setSaving(type)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          [channel]: newValue,
        }),
      })
      if (!res.ok) {
        // Revert on server error
        setPreferences((prev) =>
          prev.map((p) => (p.type === type ? { ...p, [channel]: !newValue } : p)),
        )
        toast.error(t('prefsSaveError'))
      }
    } catch {
      // Revert on network error
      setPreferences((prev) =>
        prev.map((p) => (p.type === type ? { ...p, [channel]: !newValue } : p)),
      )
      toast.error(t('prefsSaveError'))
    } finally {
      setSaving(null)
    }
  }

  const handleConnectPush = async () => {
    setPushWorking(true)
    const ok = await subscribe()
    setPushWorking(false)
    if (ok) toast.success(t('pushEnableSuccess'))
    else if (Notification.permission === 'denied') toast.error(t('pushPermissionDenied'))
    else toast.error(t('pushEnableError'))
  }

  const handleDisconnectPush = async () => {
    setPushWorking(true)
    await unsubscribe()
    setPushWorking(false)
    toast.success(t('pushDisabled'))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div>
      {/* Push notification status banner */}
      {isSupported && !pushLoading && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 mb-4 text-sm ${
          isSubscribed
            ? 'bg-teal/10 border border-green-200 text-green-800'
            : permission === 'denied'
            ? 'bg-red-900/20 border border-red-800/50 text-red-800'
            : 'bg-cobalt/10 border border-cobalt/30 text-cobalt-light'
        }`}>
          <div className="flex items-center gap-2">
            {isSubscribed ? (
              <BellRing className="w-4 h-4 shrink-0" />
            ) : (
              <BellOff className="w-4 h-4 shrink-0" />
            )}
            <span>
              {isSubscribed
                ? t('pushEnabled')
                : permission === 'denied'
                ? t('pushBlocked')
                : t('enablePushDescription')}
            </span>
          </div>
          {isSubscribed ? (
            <Button
              onClick={handleDisconnectPush}
              loading={pushWorking}
              variant="ghost"
              size="xs"
              className="ml-4 shrink-0 font-medium underline hover:no-underline"
            >
              {t('disable')}
            </Button>
          ) : permission !== 'denied' ? (
            <Button
              onClick={handleConnectPush}
              loading={pushWorking}
              size="xs"
              className="ml-4 shrink-0"
            >
              {t('enable')}
            </Button>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-600">
              <th className="text-left py-3 pr-4 font-medium text-text-secondary">{t('notification')}</th>
              <th className="text-center py-3 px-4 font-medium text-text-secondary">{t('inApp')}</th>
              <th className="text-center py-3 pl-4 font-medium text-text-secondary">
                <div className="flex items-center justify-center gap-1">
                  <Bell className="w-4 h-4" />
                  {t('push')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {preferences.map((pref) => (
              <tr key={pref.type} className="border-b border-gray-50">
                <td className="py-3 pr-4 text-white">
                  {t(TYPE_LABEL_KEYS[pref.type])}
                </td>
                <td className="py-3 px-4 text-center">
                  <button
                    onClick={() => togglePreference(pref.type, 'inApp')}
                    disabled={saving === pref.type}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      pref.inApp ? 'bg-blue-600' : 'bg-navy-600'
                    } disabled:opacity-50`}
                    role="switch"
                    aria-checked={pref.inApp}
                    aria-label={`${t('inApp')}: ${t(TYPE_LABEL_KEYS[pref.type])}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-navy-700 shadow ring-0 transition duration-200 ease-in-out ${
                        pref.inApp ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </td>
                <td className="py-3 pl-4 text-center">
                  {isSupported && isSubscribed ? (
                    <button
                      onClick={() => togglePreference(pref.type, 'browserPush')}
                      disabled={saving === pref.type}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                        pref.browserPush ? 'bg-blue-600' : 'bg-navy-600'
                      } disabled:opacity-50`}
                      role="switch"
                      aria-checked={pref.browserPush}
                      aria-label={`${t('push')}: ${t(TYPE_LABEL_KEYS[pref.type])}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-navy-700 shadow ring-0 transition duration-200 ease-in-out ${
                          pref.browserPush ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  ) : isSupported ? (
                    <Button
                      onClick={handleConnectPush}
                      variant="ghost"
                      size="xs"
                      className="text-blue-600 hover:text-cobalt-light hover:underline"
                    >
                      {t('enable')}
                    </Button>
                  ) : (
                    <span className="text-xs text-gray-400">{t('na')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
