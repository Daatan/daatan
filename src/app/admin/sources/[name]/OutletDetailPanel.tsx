'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { useTranslations } from 'next-intl'
import { Loader2, ExternalLink, ChevronLeft, Plus, X } from 'lucide-react'

type LinkItem = { label: string; url: string }

type SourceConfig = {
  type: string
  locator: string | null
  language: string | null
  enabled: boolean
  domain: string | null
}

type Impact = {
  matches: number
  forecastsAffected: number
  last30dMatches: number
  lastMatchedAt: string | null
}

type Publication = {
  title: string | null
  url: string | null
  source: string | null
  publishedAt: string | null
  pushedAt: string | null
  forecastId: string | null
  outcome: string | null
}

type OutletDetail = {
  name: string
  wikipediaUrl: string | null
  telegramChannel: string | null
  links: LinkItem[]
  notes: string | null
  sourceConfig: SourceConfig | null
  impact: Impact
  publications: Publication[]
}

interface Props {
  name: string
}

function isUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//.test(s)
}

export default function OutletDetailPanel({ name }: Props) {
  const t = useTranslations('admin')
  const [data, setData] = useState<OutletDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Edit-form state, seeded from the loaded detail.
  const [wikipediaUrl, setWikipediaUrl] = useState('')
  const [telegramChannel, setTelegramChannel] = useState('')
  const [notes, setNotes] = useState('')
  const [links, setLinks] = useState<LinkItem[]>([])

  const endpoint = `/api/admin/news-indexer/sources/${encodeURIComponent(name)}`

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.detail || `Request failed (${res.status})`)
      }
      const detail: OutletDetail = await res.json()
      setData(detail)
      setWikipediaUrl(detail.wikipediaUrl ?? '')
      setTelegramChannel(detail.telegramChannel ?? '')
      setNotes(detail.notes ?? '')
      setLinks(detail.links ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load outlet')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wikipedia_url: wikipediaUrl,
          telegram_channel: telegramChannel,
          notes,
          links: links.filter((l) => l.label.trim() && l.url.trim()),
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success(t('sourcesDetailSaved'))
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function updateLink(i: number, field: keyof LinkItem, value: string) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i))
  }

  if (loading && !data) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
  }

  if (error && !data) {
    return <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
  }

  if (!data) return null

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/sources"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> {t('sourcesDetailBack')}
      </Link>

      <h2 className="text-xl font-semibold text-white mb-1">{data.name}</h2>
      {data.sourceConfig ? (
        <p className="text-sm text-gray-400 mb-6">
          {data.sourceConfig.type} · {data.sourceConfig.language || '—'} ·{' '}
          {data.sourceConfig.enabled ? t('sourcesEnabled') : t('sourcesDisabled')}
        </p>
      ) : (
        <p className="text-sm text-amber-400/80 mb-6">{t('sourcesDetailNotConfigured')}</p>
      )}

      {/* Impact summary */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="p-3 rounded-lg bg-navy-800 border border-navy-600">
          <div className="text-2xl font-bold text-white">{data.impact.forecastsAffected}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">{t('sourcesSuggestedForecasts')}</div>
        </div>
        <div className="p-3 rounded-lg bg-navy-800 border border-navy-600">
          <div className="text-2xl font-bold text-white">{data.impact.matches}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">{t('sourcesSuggestedMatches')}</div>
        </div>
        <div className="p-3 rounded-lg bg-navy-800 border border-navy-600">
          <div className="text-2xl font-bold text-emerald-400">{data.impact.last30dMatches}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">{t('sourcesImpact30d', { count: data.impact.last30dMatches })}</div>
        </div>
      </div>

      {/* Enrichment edit form */}
      <div className="p-4 rounded-xl bg-navy-700 border border-navy-600 mb-8 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
            {t('sourcesDetailWikipedia')}
          </label>
          <input
            value={wikipediaUrl}
            onChange={(e) => setWikipediaUrl(e.target.value)}
            placeholder="https://en.wikipedia.org/wiki/..."
            className="w-full px-3 py-2 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
            {t('sourcesDetailTelegram')}
          </label>
          <input
            value={telegramChannel}
            onChange={(e) => setTelegramChannel(e.target.value)}
            placeholder="channel_username"
            className="w-full px-3 py-2 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
            {t('sourcesDetailLinks')}
          </label>
          <div className="space-y-2">
            {links.map((link, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={link.label}
                  onChange={(e) => updateLink(i, 'label', e.target.value)}
                  placeholder={t('sourcesDetailLinkLabel')}
                  className="w-1/3 px-3 py-1.5 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
                />
                <input
                  value={link.url}
                  onChange={(e) => updateLink(i, 'url', e.target.value)}
                  placeholder={t('sourcesDetailLinkUrl')}
                  className="flex-1 px-3 py-1.5 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
                />
                <button
                  onClick={() => removeLink(i)}
                  aria-label="Remove link"
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setLinks((prev) => [...prev, { label: '', url: '' }])}
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            >
              <Plus className="w-3.5 h-3.5" /> {t('sourcesDetailAddLink')}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
            {t('sourcesDetailNotes')}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t('sourcesDetailSave')}
        </button>
      </div>

      {/* Publications */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        {t('sourcesDetailPublications')} ({data.publications.length})
      </h3>
      {data.publications.length === 0 ? (
        <p className="text-sm text-gray-500">{t('sourcesDetailNoPublications')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-800 text-gray-400 text-left text-xs uppercase tracking-wide">
                <th className="px-3 py-2 font-medium">{t('sourcesDetailPublications')}</th>
                <th className="px-3 py-2 font-medium">{t('sourcesDetailForecast')}</th>
                <th className="px-3 py-2 font-medium">{t('sourcesDetailOutcome')}</th>
              </tr>
            </thead>
            <tbody>
              {data.publications.map((p, i) => (
                <tr key={i} className="border-t border-navy-700">
                  <td className="px-3 py-2 max-w-[26rem]">
                    {isUrl(p.url) ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-blue-500 hover:underline truncate">
                        <span className="truncate">{p.title || p.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-white">{p.title || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.forecastId ? (
                      <Link href={`/forecasts/${p.forecastId}`} className="text-blue-500 hover:underline">
                        {t('sourcesDetailForecast')}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{p.outcome || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
