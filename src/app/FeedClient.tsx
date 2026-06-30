'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Home, Loader2, TrendingUp, Plus, Filter, Tag, X, ArrowUpRight, ArrowDownUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'

import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import ForecastCard, { Prediction } from '@/components/forecasts/ForecastCard'
import { ForecastCardSkeleton } from '@/components/forecasts/ForecastCardSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { useCapabilities } from '@/components/CapabilitiesProvider'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('FeedClient')

type FilterStatus = 'ACTIVE' | 'PENDING' | 'RESOLVED' | 'CLOSING_SOON' | 'NEEDS_REVIEW' | 'ALL'
type SortBy = 'newest' | 'deadline' | 'cu'

const VALID_STATUSES: FilterStatus[] = ['ACTIVE', 'PENDING', 'RESOLVED', 'CLOSING_SOON', 'NEEDS_REVIEW', 'ALL']

import { STANDARD_TAGS } from '@/lib/constants'

interface FeedClientProps {
  initialPredictions?: Prediction[]
}

export default function FeedClient({ initialPredictions }: FeedClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const { selfHosted } = useCapabilities()
  // "Needs Review" is the bot-forecast approval queue; bots (and the
  // PENDING_APPROVAL status) don't exist on self-host, so hide the filter there.
  const isAdminOrApprover = session?.user?.role === 'ADMIN' || session?.user?.role === 'APPROVER'
  const t = useTranslations('feed')
  const tf = useTranslations('forecast')

  // Initialize state from URL search params
  const initialStatus = searchParams.get('status') as FilterStatus | null
  const initialTags = searchParams.get('tags')?.split(',').filter(Boolean) || []
  const initialSort = (searchParams.get('sortBy') as SortBy | null) || 'newest'
  const initialSortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc' | null) || (initialSort === 'deadline' ? 'asc' : 'desc')

  const [predictions, setPredictions] = useState<Prediction[]>(initialPredictions ?? [])
  const [isLoading, setIsLoading] = useState(!initialPredictions?.length)
  // Track whether the SSR initial data has already been used so the first
  // effect run doesn't replace it with an identical client-side fetch.
  const ssrConsumed = useRef(
    !!(initialPredictions?.length) &&
    (!initialStatus || initialStatus === 'ACTIVE') &&
    initialTags.length === 0 &&
    initialSort === 'newest' &&
    initialSortOrder === 'desc'
  )
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterStatus>(
    initialStatus && VALID_STATUSES.includes(initialStatus) ? initialStatus : 'ACTIVE'
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags)
  const [sortBy, setSortBy] = useState<SortBy>(initialSort)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialSortOrder)
  const [tagsVisible, setTagsVisible] = useState(selectedTags.length > 0)

  // Sync state to URL search params
  const syncToUrl = useCallback((status: FilterStatus, tags: string[], sort: SortBy, order: 'asc' | 'desc') => {
    const params = new URLSearchParams()
    if (status !== 'ACTIVE') params.set('status', status)
    if (tags.length > 0) params.set('tags', tags.join(','))
    if (sort !== 'newest') params.set('sortBy', sort)
    
    // Only set sortOrder if it differs from the default for that sort type
    const defaultOrder = sort === 'deadline' ? 'asc' : 'desc'
    if (order !== defaultOrder) params.set('sortOrder', order)
    
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  }, [router])

  const handleSetFilter = (newFilter: FilterStatus) => {
    setFilter(newFilter)
    syncToUrl(newFilter, selectedTags, sortBy, sortOrder)
  }

  const handleSetSort = (newSort: SortBy) => {
    // When switching sort type, set a sensible default order
    const newOrder = newSort === 'deadline' ? 'asc' : 'desc'
    setSortBy(newSort)
    setSortOrder(newOrder)
    syncToUrl(filter, selectedTags, newSort, newOrder)
  }

  const handleToggleSortOrder = () => {
    const newOrder = sortOrder === 'asc' ? 'desc' : 'asc'
    setSortOrder(newOrder)
    syncToUrl(filter, selectedTags, sortBy, newOrder)
  }

  const handleToggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(newTags)
    syncToUrl(filter, newTags, sortBy, sortOrder)
  }

  const handleClearTags = () => {
    setSelectedTags([])
    syncToUrl(filter, [], sortBy, sortOrder)
  }

  useEffect(() => {
    // Skip the first fetch cycle when SSR data was already provided.
    // Subsequent filter/sort/tag changes clear this flag and fetch normally.
    if (ssrConsumed.current) {
      ssrConsumed.current = false
      return
    }

    const fetchFeed = async () => {
      setIsLoading(true)
      setFetchError(null)
      try {
        let url = '/api/forecasts?limit=50'

        if (filter === 'ACTIVE') {
          url += '&status=ACTIVE'
        } else if (filter === 'PENDING') {
          url += '&status=PENDING'
        } else if (filter === 'RESOLVED') {
          url += '&resolvedOnly=true'
        } else if (filter === 'CLOSING_SOON') {
          url += '&status=ACTIVE&closingSoon=true'
        } else if (filter === 'NEEDS_REVIEW') {
          url += '&status=PENDING_APPROVAL'
        }

        if (selectedTags.length > 0) {
          url += `&tags=${encodeURIComponent(selectedTags.join(','))}`
        }

        // Don't send sortBy for CLOSING_SOON — that filter has its own implicit ordering
        if (filter !== 'CLOSING_SOON') {
          if (sortBy !== 'newest') url += `&sortBy=${sortBy}`
          url += `&sortOrder=${sortOrder}`
        }

        const response = await fetch(url, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (response.ok) {
          const data = await response.json()
          const preds = data.predictions || []
          setPredictions(preds)
        } else {
          const errData = await response.json().catch(() => ({}))
          const baseMsg = errData?.error || `Failed to load predictions (${response.status})`
          const detailMsg = errData?.details?.[0]?.message
          const errMsg = detailMsg ? `${baseMsg}: ${detailMsg}` : baseMsg
          setFetchError(errMsg)
          setPredictions([])
        }
      } catch (error) {
        log.error({ err: error }, 'Error fetching feed')
        setFetchError(error instanceof Error ? error.message : 'Failed to load predictions')
        setPredictions([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchFeed()
  }, [filter, selectedTags, sortBy, sortOrder])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cobalt/10 rounded-lg">
            <Home className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{t('title')}</h1>
          </div>
        </div>
        <Button
          href="/create"
          size="lg"
          leftIcon={<Plus className="w-5 h-5" />}
        >
          {t('newForecast')}
        </Button>
      </div>

      {/* Filters + Sort (single toolbar row) */}
      <div className="mb-6 space-y-3">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 min-w-max">
            <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <button
              onClick={() => handleSetFilter('ACTIVE')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'ACTIVE'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-cobalt/10 text-cobalt-light border border-cobalt/30 hover:bg-blue-100'
                }`}
            >
              {t('filters.open')}
            </button>
            <button
              onClick={() => handleSetFilter('CLOSING_SOON')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'CLOSING_SOON'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
                }`}
            >
              {t('filters.closingSoon')}
            </button>
            <button
              onClick={() => handleSetFilter('PENDING')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'PENDING'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
                }`}
            >
              {t('filters.awaitingResolution')}
            </button>
            {isAdminOrApprover && !selfHosted && (
              <button
                onClick={() => handleSetFilter('NEEDS_REVIEW')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'NEEDS_REVIEW'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-purple-900/20 text-purple-700 hover:bg-purple-100 border border-purple-100'
                  }`}
              >
                {t('filters.needsReview')}
              </button>
            )}
            <button
              onClick={() => handleSetFilter('RESOLVED')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'RESOLVED'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
                }`}
            >
              {t('filters.resolved')}
            </button>
            <button
              onClick={() => handleSetFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === 'ALL'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
                }`}
            >
              {t('filters.all')}
            </button>

            {/* Sort — hidden for Closing Soon (has its own implicit ordering) */}
            {filter !== 'CLOSING_SOON' && (
              <>
                <div className="w-px h-5 bg-navy-600 mx-1 flex-shrink-0" />
                <button
                  onClick={handleToggleSortOrder}
                  className="p-1.5 rounded-lg bg-navy-700 hover:bg-navy-600 text-gray-400 hover:text-white transition-all group relative"
                  title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                >
                  <ArrowDownUp className={`w-4 h-4 transition-transform duration-300 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  </span>
                </button>
                {([
                  { value: 'newest', label: t('sort.newest') },
                  { value: 'deadline', label: t('sort.byDeadline') },
                  { value: 'cu', label: t('sort.mostStaked') },
                ] as { value: SortBy; label: string }[]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleSetSort(value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${sortBy === value
                      ? 'bg-gray-800 text-white shadow-sm'
                      : 'bg-navy-700 text-gray-400 hover:bg-navy-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </>
            )}

            {/* Tags toggle */}
            <div className="w-px h-5 bg-navy-600 mx-1 flex-shrink-0" />
            <button
              onClick={() => setTagsVisible(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tagsVisible
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-navy-700 text-gray-400 hover:bg-navy-600'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              {t('tags')}
              {selectedTags.length > 0 && (
                <span className="ml-0.5 bg-white/20 text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {selectedTags.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tag Multi-Select Filter */}
        {tagsVisible && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {selectedTags.length > 0 && (
                <button
                  onClick={handleClearTags}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors"
                  aria-label="Clear all selected tags"
                >
                  <X className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {STANDARD_TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => handleToggleTag(tag)}
                    aria-pressed={isSelected}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 flex items-center gap-1.5 ${isSelected
                      ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600'
                      : 'bg-navy-700 text-gray-400 hover:bg-navy-600 hover:text-mist'
                      }`}
                  >
                    {tag}
                    {isSelected && (
                      <X className="w-3 h-3 ml-0.5 opacity-70 hover:opacity-100" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Feed Content */}
      {fetchError && (
        <div className="mb-6 bg-red-900/20 border border-red-800/40 text-red-400 px-4 py-3 rounded-lg text-sm">
          <strong>Error loading forecasts:</strong> {fetchError}
        </div>
      )}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <ForecastCardSkeleton key={i} />)}
        </div>
      ) : predictions.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<TrendingUp className="w-10 h-10 text-blue-500" />}
          iconBgClass="bg-cobalt/10"
          title={t(`empty_${filter}`)}
          description={t(`emptyDesc_${filter}`)}
          action={{ label: t('createFirst'), href: '/create', icon: <Plus className="w-4 h-4" /> }}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {predictions.map((prediction) => (
              <ForecastCard
                key={prediction.id}
                prediction={prediction}
                showModerationControls={true}
                onMutated={(id) => setPredictions(prev => prev.filter(p => p.id !== id))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floating New Forecast button — always visible while scrolling the feed.
          z-40 keeps transient PWA/push prompts (z-50) above it. end-4 is RTL-aware. */}
      <Button
        href="/create"
        size="lg"
        leftIcon={<Plus className="w-5 h-5" />}
        className="fixed bottom-4 end-4 z-40 shadow-lg shadow-black/30"
      >
        {t('newForecast')}
      </Button>
    </div>
  )
}
