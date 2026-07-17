'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Layers } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'

interface SimilarForecast {
  id: string
  slug: string | null
  claimText: string
  status: string
  resolveByDatetime: string
  author: { name: string | null; username: string | null }
  translated?: boolean
}

interface Props {
  predictionId: string
}

export function SimilarForecasts({ predictionId }: Props) {
  const t = useTranslations('forecast')
  const locale = useLocale()
  const [items, setItems] = useState<SimilarForecast[]>([])

  useEffect(() => {
    let cancelled = false

    fetch(`/api/forecasts/similar?id=${predictionId}&limit=3&language=${locale}`)
      .then(r => r.ok ? r.json() : { similar: [] })
      .then((data: { similar?: SimilarForecast[] }) => {
        const similar = data.similar ?? []
        if (cancelled) return
        setItems(similar)
        if (locale === 'en') return

        // Fill translation-cache misses through the same cached-or-generate
        // endpoint ForecastCard uses, so the next visitor gets a server-side hit.
        for (const item of similar.filter(i => !i.translated)) {
          fetch(`/api/forecasts/${item.id}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: locale }),
          })
            .then(r => r.ok ? r.json() : null)
            .then((translated: { claimText?: string } | null) => {
              if (cancelled || !translated?.claimText) return
              setItems(prev =>
                prev.map(p =>
                  p.id === item.id ? { ...p, claimText: translated.claimText!, translated: true } : p
                )
              )
            })
            .catch(() => {})
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [predictionId, locale])

  if (items.length === 0) return null

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
        <Layers className="w-4 h-4" />
        {t('seeAlso')}
      </h3>
      <div className="space-y-2">
        {items.map(item => (
          <Link
            key={item.id}
            href={`/forecasts/${item.slug || item.id}`}
            className="block p-3 rounded-lg border border-navy-600 bg-navy-700 hover:border-blue-500/50 hover:bg-navy-600 transition-colors"
          >
            <p className="text-sm text-white line-clamp-2">{item.claimText}</p>
            <p className="text-xs text-gray-500 mt-1">
              {item.author.name || item.author.username || t('anonymous')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
