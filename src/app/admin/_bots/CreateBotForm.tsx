'use client'
import { useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Props {
  onCreated: () => void
  onCancel: () => void
}

export function CreateBotForm({ onCreated, onCancel }: Props) {
  const t = useTranslations('admin')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (res.ok) {
        onCreated()
      } else {
        setError(data.error ?? t('failedToCreateBot'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 mb-4 bg-cobalt/10 border-cobalt/30">
      <h3 className="font-semibold text-mist mb-3">{t('newBotTitle')}</h3>
      <form onSubmit={submit} className="flex gap-2 items-end flex-wrap">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('displayName')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('displayNamePlaceholder')}
            className="border rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            required
            minLength={2}
          />
          <div className="text-xs text-gray-400 mt-0.5">{t('usernameWillBe', { username: `${name.toLowerCase().replace(/\s+/g, '_')}_b` })}</div>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {t('create')}
          </button>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1.5 text-gray-500 hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
      </form>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      <p className="mt-2 text-xs text-gray-500">
        {t('createBotHint')}
      </p>
    </div>
  )
}
