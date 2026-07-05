'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, Plus, Filter, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ForecastCard, { Prediction } from '@/components/forecasts/ForecastCard'
import { ForecastCardSkeleton } from '@/components/forecasts/ForecastCardSkeleton'
import EmptyState from '@/components/ui/EmptyState'

type FilterStatus = 'ACTIVE' | 'PENDING' | 'RESOLVED' | 'CLOSING_SOON' | 'ALL'

export function PredictionsPage({ initialPredictions }: { initialPredictions?: Prediction[] }) {
  const t = useTranslations('forecastsFeed')
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''

  const [predictions, setPredictions] = useState<Prediction[]>(initialPredictions ?? [])
  const [isLoading, setIsLoading] = useState(!initialPredictions?.length)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterStatus>('ACTIVE')
  const [searchInput, setSearchInput] = useState(initialQ)
  const [activeQuery, setActiveQuery] = useState(initialQ)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Skip the first client-side fetch when SSR data covers the default view (ACTIVE, no query)
  const ssrConsumed = useRef(!!(initialPredictions?.length) && !initialQ)

  // Sync activeQuery when URL changes (e.g. sidebar search navigates here)
  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    setActiveQuery(q)
    setSearchInput(q)
  }, [searchParams])

  useEffect(() => {
    if (ssrConsumed.current && filter === 'ACTIVE' && !activeQuery) {
      ssrConsumed.current = false
      return
    }

    const fetchPredictions = async () => {
      setIsLoading(true)
      setFetchError(null)
      try {
        let url = '/api/forecasts?limit=50'

        if (filter === 'ACTIVE') url += '&status=ACTIVE'
        else if (filter === 'PENDING') url += '&status=PENDING'
        else if (filter === 'RESOLVED') url += '&resolvedOnly=true'
        else if (filter === 'CLOSING_SOON') url += '&status=ACTIVE&closingSoon=true'

        if (activeQuery) url += `&q=${encodeURIComponent(activeQuery)}`

        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          setPredictions(data.predictions)
        } else {
          const errData = await response.json().catch(() => ({}))
          setFetchError(errData?.details?.[0]?.message || errData?.error || `Failed to load (${response.status})`)
          setPredictions([])
        }
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : 'Failed to load predictions')
        setPredictions([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchPredictions()
  }, [filter, activeQuery])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchInput.trim()
    setActiveQuery(q)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    router.replace(`/forecasts${params.size ? `?${params}` : ''}`)
  }

  const clearSearch = () => {
    setSearchInput('')
    setActiveQuery('')
    router.replace('/forecasts')
  }

  const filterLabel = {
    ACTIVE: t('labelOpen'),
    CLOSING_SOON: t('labelClosingSoon'),
    PENDING: t('labelPending'),
    RESOLVED: t('labelResolved'),
    ALL: t('labelAll'),
  }[filter]

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 lg:mb-8">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
        </div>
        <Link
          href="/predictions/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline">{t('newForecast')}</span>
        </Link>
      </div>

      {fetchError && (
        <div className="mb-6 bg-red-900/20 border border-red-800/40 text-red-400 px-4 py-3 rounded-lg text-sm">
          <strong>{t('errorLoading')}</strong> {fetchError}
        </div>
      )}

      {/* Search + Filters */}
      <div className="mb-6 space-y-3">
        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="w-full bg-navy-700 text-white text-sm pl-9 pr-8 py-2 rounded-lg border border-navy-600 outline-none focus:border-blue-500 placeholder-gray-500"
            />
            {searchInput && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            {t('search')}
          </button>
        </form>

        {/* Status filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />
          {(['ACTIVE', 'CLOSING_SOON', 'PENDING', 'RESOLVED', 'ALL'] as FilterStatus[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
              }`}
            >
              {f === 'ACTIVE' ? t('filterOpen') : f === 'CLOSING_SOON' ? t('filterClosingSoon') : f === 'PENDING' ? t('filterPending') : f === 'RESOLVED' ? t('filterResolved') : t('filterAll')}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <ForecastCardSkeleton key={i} />)}
        </div>
      ) : predictions.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={<TrendingUp className="w-8 h-8 text-gray-400" />}
          iconBgClass="bg-navy-700"
          title={activeQuery ? t('noResults', { query: activeQuery }) : t('empty')}
          description={activeQuery ? t('noResultsHint') : t('emptyHint')}
          action={activeQuery ? { label: t('clearSearch'), href: '/forecasts' } : { label: t('createForecast'), href: '/predictions/new', icon: <Plus className="w-5 h-5" /> }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
              {filterLabel}
              {activeQuery && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-full text-xs font-medium">
                  <Search className="w-3 h-3" />
                  {activeQuery}
                  <button onClick={clearSearch} aria-label="Clear search" className="hover:text-white ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </h2>
            <span className="text-sm text-gray-500">{t('resultsCount', { count: predictions.length })}</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {predictions.map((prediction) => (
              <ForecastCard key={prediction.id} prediction={prediction} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
