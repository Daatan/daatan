'use client'
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

type Settings = {
  appName: string
  appLogoUrl: string
  aboutTitle: string
  aboutBody: string
  openrouterModel: string
  openrouterKeyConfigured: boolean
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-white mb-1">{label}</span>
      {hint && <span className="block text-xs text-gray-400 mb-1.5">{hint}</span>}
      {children}
    </label>
  )
}

const inputCls =
  'w-full bg-navy-800 text-white text-sm px-3 py-2 rounded-lg border border-navy-600 outline-none focus:border-blue-500 placeholder-gray-500'

export default function SettingsPanel() {
  const [data, setData] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Local edit buffers for non-secret fields.
  const [appName, setAppName] = useState('')
  const [appLogoUrl, setAppLogoUrl] = useState('')
  const [aboutTitle, setAboutTitle] = useState('')
  const [aboutBody, setAboutBody] = useState('')
  const [model, setModel] = useState('')
  // Secret: only sent when the admin types a replacement.
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Settings | null) => {
        if (!d) return
        setData(d)
        setAppName(d.appName)
        setAppLogoUrl(d.appLogoUrl)
        setAboutTitle(d.aboutTitle)
        setAboutBody(d.aboutBody)
        setModel(d.openrouterModel)
      })
      .finally(() => setLoading(false))
  }, [])

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName,
          appLogoUrl,
          aboutTitle,
          aboutBody,
          openrouterModel: model,
          ...(editingKey && keyInput.trim() ? { openrouterKey: keyInput } : {}),
          ...extra,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
      toast.success('Settings saved')
      // Re-read so the key badge + cleared inputs reflect the new state.
      const fresh: Settings = await fetch('/api/admin/settings').then((r) => r.json())
      setData(fresh)
      setModel(fresh.openrouterModel)
      setKeyInput('')
      setEditingKey(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }
  if (!data) return <div className="text-center py-12 text-gray-500 text-sm">Failed to load.</div>

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Branding */}
      <section className="bg-navy-700 border border-navy-600 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Branding</h2>
        <Field label="App name" hint="Shown in the sidebar, page titles, and AI prompts. Leave blank to use the default.">
          <input className={inputCls} value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Forecasting" />
        </Field>
        <Field label="Logo URL" hint="Optional. A full URL to your logo; leave blank to use the bundled mark.">
          <input className={inputCls} value={appLogoUrl} onChange={(e) => setAppLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
        </Field>
      </section>

      {/* About page */}
      <section className="bg-navy-700 border border-navy-600 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">About page</h2>
        <Field label="Title">
          <input className={inputCls} value={aboutTitle} onChange={(e) => setAboutTitle(e.target.value)} placeholder="About" />
        </Field>
        <Field label="Body (Markdown)" hint="Shown to all users at /about. Supports Markdown (headings, lists, links, bold).">
          <textarea className={`${inputCls} font-mono min-h-[180px]`} value={aboutBody} onChange={(e) => setAboutBody(e.target.value)} placeholder="# Welcome&#10;Use this space to describe your internal forecasting program." />
        </Field>
      </section>

      {/* AI */}
      <section className="bg-navy-700 border border-navy-600 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">AI (OpenRouter)</h2>
        <Field label="API key" hint="Powers Express + AI features. Stored in your database; never shown again after saving.">
          {!editingKey ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-gray-300">
                {data.openrouterKeyConfigured ? '•••••••• configured' : 'not set'}
              </span>
              <button type="button" onClick={() => setEditingKey(true)} className="text-sm text-blue-400 hover:text-blue-300">
                {data.openrouterKeyConfigured ? 'Replace' : 'Add key'}
              </button>
              {data.openrouterKeyConfigured && (
                <button
                  type="button"
                  onClick={() => save({ clearOpenrouterKey: true })}
                  disabled={saving}
                  className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                className={inputCls}
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-or-…"
                autoFocus
              />
              <button type="button" onClick={() => { setEditingKey(false); setKeyInput('') }} className="text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
            </div>
          )}
        </Field>
        <Field label="Model" hint="OpenRouter model slug. Leave blank for the default (openai/gpt-4o-mini).">
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/gpt-4o-mini" />
        </Field>
      </section>

      <button
        type="button"
        onClick={() => save()}
        disabled={saving}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Save settings
      </button>
    </div>
  )
}
