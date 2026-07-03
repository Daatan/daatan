'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { TrendingUp, Loader2, ExternalLink, X, ChevronRight, ChevronDown } from 'lucide-react'
import type { Prediction } from './types'

type Suggestion = {
  provider: 'POLYMARKET' | 'KALSHI'
  externalId: string
  slug: string
  question: string
  yesProbability: number
  url: string
}

interface Props {
  prediction: Prediction
}

const PROVIDER_LABEL: Record<string, string> = {
  POLYMARKET: 'Polymarket',
  KALSHI: 'Kalshi',
}

/**
 * Admin-only control to link/unlink an external market (Polymarket / Kalshi) to
 * this forecast. Manual is authoritative (paste a URL); "Suggest matches" offers
 * candidates the admin still confirms. Renders nothing for non-admins.
 */
export function ExternalMarketLinkAdmin({ prediction }: Props) {
  const { data: session } = useSession()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)

  if (session?.user?.role !== 'ADMIN') return null

  const market = prediction.externalMarket
  const endpoint = `/api/admin/forecasts/${prediction.id}/external-market`

  // Collapsed by default — keeps the admin tool out of the way so the resolver
  // view stays clean. A quiet one-line affordance expands the full control.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-pink-400 transition-colors"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        <span>
          {market
            ? `${PROVIDER_LABEL[market.provider] ?? market.provider} market linked`
            : 'Link external market'}
        </span>
        <span className="text-gray-600">· admin</span>
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    )
  }

  async function link(targetUrl: string) {
    if (!targetUrl.trim()) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Link failed')
      }
      toast.success('Market linked')
      setUrl('')
      setSuggestions(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Link failed')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      const res = await fetch(endpoint, { method: 'DELETE' })
      if (!res.ok) throw new Error('Unlink failed')
      toast.success('Unlinked')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unlink failed')
    } finally {
      setBusy(false)
    }
  }

  async function setInverted(inverted: boolean) {
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inverted }),
      })
      if (!res.ok) throw new Error('Update failed')
      toast.success(inverted ? 'Marked as inverted — showing 100 − price' : 'Inversion removed')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function suggest() {
    setBusy(true)
    try {
      const res = await fetch(endpoint)
      const data = await res.json()
      setSuggestions(data.suggestions ?? [])
    } catch {
      toast.error('Suggestion failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-8 p-4 border border-pink-500/30 rounded-xl bg-navy-700">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-pink-400">
          <TrendingUp className="w-3.5 h-3.5" /> External market link (admin)
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse"
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {market ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <a
              href={market.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-200 hover:text-pink-300 inline-flex items-center gap-1 min-w-0"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-pink-400 shrink-0">
                {PROVIDER_LABEL[market.provider] ?? market.provider}
              </span>
              <span className="truncate">{market.question}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
            <button
              onClick={unlink}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-red-400 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" /> Unlink
            </button>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={prediction.externalMarketInverted ?? false}
              onChange={e => setInverted(e.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-pink-500"
            />
            <span>
              <span className="font-medium text-gray-300">Inverted</span> — the market asks the{' '}
              <em>opposite</em> of this claim (e.g. claim “X will <em>not</em> win” vs market
              “Will X win?”). When checked, the site shows 100 − market price everywhere.
            </span>
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://polymarket.com/event/… or kalshi.com/…"
              className="flex-1 px-3 py-2 text-sm bg-navy-800 border border-navy-600 rounded-lg text-white placeholder-gray-500"
            />
            <button
              onClick={() => link(url)}
              disabled={busy || !url.trim()}
              className="px-3 py-2 text-sm font-semibold bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Link
            </button>
          </div>
          <button onClick={suggest} disabled={busy} className="text-xs text-pink-400 hover:text-pink-300 disabled:opacity-50">
            Suggest matches (AI)
          </button>
          {suggestions && suggestions.length === 0 && (
            <p className="text-xs text-gray-500 italic">No candidates found.</p>
          )}
          {suggestions && suggestions.length > 0 && (
            <p className="text-[11px] text-gray-500">
              Matching is semantic and can miss negation — make sure the market asks the{' '}
              <em>same direction</em> as the claim. If it asks the opposite, link it and tick
              “Inverted”.
            </p>
          )}
          {suggestions && suggestions.length > 0 && (
            <ul className="space-y-1">
              {suggestions.map(s => (
                <li key={`${s.provider}-${s.externalId}`}>
                  <button
                    onClick={() => link(s.url)}
                    disabled={busy}
                    className="w-full text-left text-xs px-2 py-1.5 rounded bg-navy-800 hover:bg-navy-600 text-gray-300 flex items-center justify-between gap-2 disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-pink-400/80 shrink-0">
                        {PROVIDER_LABEL[s.provider] ?? s.provider}
                      </span>
                      <span className="truncate">{s.question}</span>
                    </span>
                    <span className="text-pink-400 font-semibold shrink-0">{s.yesProbability}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
