'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'

/**
 * Toggle for the experimental AI-panel chart lines (docs/LASSO.md §8). Off by
 * default; when on, forecast charts show the per-model estimate lines as a hidden,
 * opt-in source — separate from and with no effect on the Oracle line.
 */
export default function AiPanelPreference() {
  const t = useTranslations('settings')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/user/preferences')
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.showAiPanel)))
      .catch(() => setEnabled(false))
  }, [])

  const toggle = async () => {
    if (enabled == null || saving) return
    const next = !enabled
    setSaving(true)
    setEnabled(next) // optimistic
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showAiPanel: next }),
      })
      if (!res.ok) {
        // Revert AND say so — a switch that silently flips back reads as a UI bug.
        setEnabled(!next)
        toast.error(t('aiPanelSaveError'))
      }
    } catch {
      setEnabled(!next)
      toast.error(t('aiPanelSaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-white">{t('aiPanel')}</p>
        <p className="text-sm text-gray-500">{t('aiPanelDescription')}</p>
      </div>
      <button
        onClick={toggle}
        disabled={enabled == null || saving}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
          enabled ? 'bg-blue-600' : 'bg-navy-600'
        } disabled:opacity-50`}
        role="switch"
        aria-checked={enabled ?? false}
        aria-label={t('aiPanel')}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-navy-700 shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}
