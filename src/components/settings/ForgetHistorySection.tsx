'use client'

import { useState } from 'react'
import { EyeOff } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

export default function ForgetHistorySection() {
  const t = useTranslations('settings')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleForget = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/account/forget-history', { method: 'POST' })
      if (res.status === 400) {
        toast.error(t('forgetHistoryBlocked'))
        return
      }
      if (!res.ok) throw new Error(t('forgetHistoryError'))
      toast.success(t('forgetHistorySuccess'))
      router.refresh()
    } catch {
      toast.error(t('forgetHistoryError'))
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  return (
    <div className="p-6">
      <p className="text-sm text-gray-500 mb-4">{t('forgetHistoryDescription')}</p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-900/20 border border-red-800/50 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-900/40 transition-colors"
        >
          <EyeOff className="w-4 h-4" />
          {t('forgetHistory')}
        </button>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-red-400 font-semibold">
            {t('forgetHistoryWarning')}
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleForget}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t('forgettingHistory') : t('confirmForgetHistory')}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="px-4 py-2 bg-navy-600 text-text-secondary rounded-xl text-sm font-semibold hover:bg-navy-500 transition-colors"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
