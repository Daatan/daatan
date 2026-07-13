'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { WarningBanner } from '@/components/ui/WarningBanner'

interface SimilarForecast {
  id: string
  slug: string | null
  claimText: string
  author: { name: string | null; username: string | null }
}

interface Props {
  claimText: string
  tags?: string[]
  minClaimLength?: number
  debounceMs?: number
  limit?: number
}

export function SimilarForecastsWarning({
  claimText,
  tags = [],
  minClaimLength = 20,
  debounceMs = 1000,
  limit = 3,
}: Props) {
  const t = useTranslations('forecast')
  const [items, setItems] = useState<SimilarForecast[]>([])
  const lastQuery = useRef('')

  useEffect(() => {
    const claim = claimText?.trim() || ''
    const queryKey = `${claim}|${tags.join(',')}`
    if (claim.length < minClaimLength || queryKey === lastQuery.current) return

    const timer = setTimeout(async () => {
      lastQuery.current = queryKey
      try {
        const params = new URLSearchParams({ q: claim, limit: String(limit) })
        if (tags.length > 0) params.set('tags', tags.join(','))
        const res = await fetch(`/api/forecasts/similar?${params}`)
        if (res.ok) {
          const data = await res.json()
          setItems(data.similar ?? [])
        }
      } catch { /* ignore network errors */ }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [claimText, tags, minClaimLength, debounceMs, limit])

  if (items.length === 0) return null

  return (
    <WarningBanner icon={<Copy className="w-4 h-4" />} title={t('similarWarningTitle')}>
      <div className="space-y-1.5">
        {items.map(f => (
          <Link
            key={f.id}
            href={`/forecasts/${f.slug || f.id}`}
            target="_blank"
            className="block text-xs text-gray-300 hover:text-white truncate hover:underline"
          >
            → {f.claimText}
          </Link>
        ))}
      </div>
      <p className="text-xs text-gray-500">{t('similarWarningHint')}</p>
    </WarningBanner>
  )
}
