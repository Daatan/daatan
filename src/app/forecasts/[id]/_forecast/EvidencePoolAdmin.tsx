'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'react-hot-toast'
import { Database, Loader2, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

type PoolArticle = {
  id: string
  url: string
  title: string | null
  source: string | null
  publishedDate: string | null
  stance: number | null
  certainty: number | null
  origin: string
  excluded: boolean
}

interface Props {
  predictionId: string
}

/**
 * Admin-only view of a forecast's evidence pool (retro
 * docs/ORACLE_VARIABLES.md §6 part 2) — every article analyze/news-indexer/
 * backfill have extracted a signal from, with a per-article exclude toggle.
 * Excluding an article here does NOT yet change the live estimate: nothing
 * reads this table to compute one until the recompute-over-pool cutover
 * ships. This only gives an admin a place to record the decision ahead of
 * that cutover. Renders nothing for non-admins.
 */
export function EvidencePoolAdmin({ predictionId }: Props) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [articles, setArticles] = useState<PoolArticle[] | null>(null)

  if (session?.user?.role !== 'ADMIN') return null

  const endpoint = `/api/admin/forecasts/${predictionId}/evidence-pool`

  async function expand() {
    setOpen(true)
    if (articles !== null) return
    setLoading(true)
    try {
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error('Failed to load evidence pool')
      const data = await res.json()
      setArticles(data.articles ?? [])
    } catch {
      toast.error('Failed to load evidence pool')
      setArticles([])
    } finally {
      setLoading(false)
    }
  }

  async function toggleExcluded(article: PoolArticle) {
    setBusyId(article.id)
    try {
      const res = await fetch(`${endpoint}/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: !article.excluded }),
      })
      if (!res.ok) throw new Error('Update failed')
      setArticles(prev =>
        (prev ?? []).map(a => (a.id === article.id ? { ...a, excluded: !article.excluded } : a)),
      )
      toast.success(!article.excluded ? 'Article excluded' : 'Article re-included')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  if (!open) {
    return (
      <button
        onClick={expand}
        className="mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-cyan-400 transition-colors"
      >
        <Database className="w-3.5 h-3.5" />
        <span>Evidence pool</span>
        <span className="text-gray-600">· admin</span>
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    )
  }

  return (
    <div className="mb-8 p-4 border border-cyan-500/30 rounded-xl bg-navy-700">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
          <Database className="w-3.5 h-3.5" /> Evidence pool (admin)
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse"
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mb-3">
        Every article extracted for this forecast so far. Excluding an article here doesn&apos;t
        change the live estimate yet — it records the decision ahead of the pool cutover.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      )}

      {!loading && articles && articles.length === 0 && (
        <p className="text-xs text-gray-500 italic">No pooled articles yet.</p>
      )}

      {!loading && articles && articles.length > 0 && (
        <ul className="space-y-1.5">
          {articles.map(article => (
            <li
              key={article.id}
              className="flex items-start justify-between gap-3 text-xs px-2 py-1.5 rounded bg-navy-800"
            >
              <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={article.excluded}
                  disabled={busyId === article.id}
                  onChange={() => toggleExcluded(article)}
                  className="mt-0.5 accent-cyan-500 shrink-0"
                  aria-label={`Exclude ${article.title ?? article.url}`}
                />
                <span className="min-w-0">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 hover:text-cyan-300 ${article.excluded ? 'line-through text-gray-500' : 'text-gray-200'}`}
                  >
                    <span className="truncate">{article.title || article.url}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  <span className="block text-[10px] text-gray-500">
                    {article.source || 'unknown source'}
                    {article.publishedDate ? ` · ${article.publishedDate}` : ''} · {article.origin}
                    {typeof article.stance === 'number' && typeof article.certainty === 'number'
                      ? ` · stance ${article.stance.toFixed(2)} / certainty ${article.certainty.toFixed(2)}`
                      : ''}
                  </span>
                </span>
              </label>
              {busyId === article.id && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
