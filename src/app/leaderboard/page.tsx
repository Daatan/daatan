'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Trophy, Loader2, Medal, Target, TrendingDown, Swords, Bot, Newspaper, Users } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { createClientLogger } from '@/lib/client-logger'
import { useTranslations } from 'next-intl'
import { FETCH_LIMIT, LOWER_IS_BETTER, formatSigned, orderForDisplay, type LeaderboardUser, type SortBy, type SortDir } from './sort'

const log = createClientLogger('Leaderboard')

type TagOption = { name: string; slug: string }

export default function LeaderboardPage() {
  const t = useTranslations('leaderboard')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [users, setUsers] = useState<LeaderboardUser[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [sortBy, setSortBy] = useState<SortBy>('elo')
  const [sortDir, setSortDir] = useState<SortDir>('best')
  const [selectedTag, setSelectedTag] = useState<string | null>(searchParams.get('tag'))

  const SORT_OPTIONS: { value: SortBy; label: string; icon: typeof Target }[] = [
    { value: 'elo', label: t('sortBy.elo'), icon: Swords },
    { value: 'accuracy', label: t('sortBy.accuracy'), icon: Target },
    { value: 'brierScore', label: t('sortBy.brierScore'), icon: TrendingDown },
    { value: 'peerScore', label: t('sortBy.peerScore'), icon: Users },
    { value: 'aiScore', label: t('sortBy.aiScore'), icon: Bot },
  ]

  // A new column starts best-first; clicking the active column flips the order.
  const handleSort = (key: SortBy) => {
    if (key === sortBy) {
      setSortDir(d => (d === 'best' ? 'worst' : 'best'))
    } else {
      setSortBy(key)
      setSortDir('best')
    }
  }

  const rankById = new Map(users.map((u, i) => [u.id, i]))
  const displayed = orderForDisplay(users, sortBy, sortDir)

  const fetchLeaderboardKey = `${sortBy}|${selectedTag}`
  const [fetchLeaderboardLoadedKey, setFetchLeaderboardLoadedKey] = useState<string | null>(null)
  const isLoading = fetchLeaderboardLoadedKey !== fetchLeaderboardKey

  const fetchLeaderboard = useCallback(async () => {
    try {
      try {
        const params = new URLSearchParams({ limit: FETCH_LIMIT, sortBy })
        if (selectedTag) params.set('tag', selectedTag)
        const response = await fetch(`/api/leaderboard?${params}`)
        if (response.ok) {
          const data = await response.json()
          setUsers(data.leaderboard)
        }
      } catch (error) {
        log.error({ err: error }, 'Error fetching leaderboard')
      }
    } finally {
      setFetchLeaderboardLoadedKey(fetchLeaderboardKey)
    }
  }, [sortBy, selectedTag, fetchLeaderboardKey])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  // Fetch available tags once
  useEffect(() => {
    fetch('/api/tags?limit=20')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.tags) setTags(data.tags) })
      .catch(() => {})
  }, [])

  // Sync tag to URL
  const handleTagChange = (slug: string | null) => {
    setSelectedTag(slug)
    const params = new URLSearchParams(searchParams.toString())
    if (slug) params.set('tag', slug)
    else params.delete('tag')
    router.replace(`${pathname}?${params}`)
  }

  const selectedTagName = selectedTag
    ? (tags.find(tag => tag.slug === selectedTag)?.name ?? selectedTag)
    : null

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Medal className="w-6 h-6 text-yellow-500" />
      case 1: return <Medal className="w-6 h-6 text-gray-400" />
      case 2: return <Medal className="w-6 h-6 text-amber-600" />
      default: return <span className="text-lg font-bold text-gray-400 w-6 text-center">{index + 1}</span>
    }
  }

  // The two extra columns only fit from sm up; the active one always shows.
  const isExtra = (key: SortBy) => key === 'peerScore' || key === 'aiScore'
  const cellVisibility = (key: SortBy) => (isExtra(key) && sortBy !== key ? 'hidden sm:table-cell' : '')

  const headerClass = (key: SortBy) =>
    `px-2 sm:px-4 py-4 text-xs font-bold uppercase tracking-wider break-words text-right w-20 sm:w-24 ${cellVisibility(key)} ${
      sortBy === key ? 'text-white' : 'text-gray-500'
    }`

  // Arrow shows the value order: best-first is descending, except where lower is better.
  const sortArrow = (key: SortBy) => {
    if (sortBy !== key) return null
    const descending = (sortDir === 'best') !== Boolean(LOWER_IS_BETTER[key])
    return <span aria-hidden="true">{descending ? ' ↓' : ' ↑'}</span>
  }

  const ariaSort = (key: SortBy): 'ascending' | 'descending' | 'none' => {
    if (sortBy !== key) return 'none'
    return (sortDir === 'best') !== Boolean(LOWER_IS_BETTER[key]) ? 'descending' : 'ascending'
  }

  // Column hints reuse the legend text. Shown on hover and on keyboard focus; on
  // touch screens a tap triggers hover, so the hint appears with the sort.
  const HINT_KEY: Record<SortBy, string> = {
    elo: 'legend.eloDesc',
    accuracy: 'legend.accuracyDesc',
    brierScore: 'legend.brierDesc',
    peerScore: 'legend.peerScoreDesc',
    aiScore: 'legend.aiScoreDesc',
  }

  const sortHeader = (sortKey: SortBy, children: ReactNode) => (
    <th className={`${headerClass(sortKey)} relative group`} aria-sort={ariaSort(sortKey)}>
      <button
        type="button"
        onClick={() => handleSort(sortKey)}
        aria-describedby={`lb-hint-${sortKey}`}
        className="uppercase tracking-wider font-bold text-right hover:text-white transition-colors"
      >
        {children}
        {sortArrow(sortKey)}
      </button>
      <span
        id={`lb-hint-${sortKey}`}
        role="tooltip"
        className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100 transition-opacity absolute right-0 top-full z-20 mt-1 w-48 sm:w-64 rounded-lg border border-navy-600 bg-navy-800 p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-gray-300 shadow-lg"
      >
        {t(HINT_KEY[sortKey])}
      </span>
    </th>
  )

  const valueClass = (key: SortBy) =>
    sortBy === key ? 'font-black text-white text-base sm:text-lg' : 'font-bold text-text-secondary text-sm'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="p-4 bg-amber-900/20 rounded-2xl mb-4">
          <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-yellow-500" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-2 tracking-tight">{t('title')}</h1>
        <p className="text-gray-500 max-w-md">{t('subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link
            href="/leaderboard/ai"
            className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
          >
            <Bot className="w-4 h-4" />
            {t('aiPanelLink')}
          </Link>
          <Link
            href="/leaderboard/sources"
            className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
          >
            <Newspaper className="w-4 h-4" />
            {t('sourceLeaderboardLink')}
          </Link>
        </div>
      </div>

      {/* Sort Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => handleSort(value)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
              sortBy === value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
            }`}
            aria-label={`Sort by ${label}`}
            aria-pressed={sortBy === value}
          >
            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tag Filter */}
      {tags.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">{t('filterByTopic')}:</span>
          <button
            onClick={() => handleTagChange(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
              !selectedTag ? 'bg-blue-600 text-white' : 'bg-navy-700 text-gray-400 hover:bg-navy-600'
            }`}
          >
            {t('allTopics')}
          </button>
          {tags.map(tag => (
            <button
              key={tag.slug}
              onClick={() => handleTagChange(selectedTag === tag.slug ? null : tag.slug)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                selectedTag === tag.slug ? 'bg-blue-600 text-white' : 'bg-navy-700 text-gray-400 hover:bg-navy-600'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Leaderboard Table */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-gray-500 font-medium">{t('calculating')}</p>
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Trophy className="w-10 h-10 text-yellow-500" />}
          iconBgClass="bg-amber-900/20"
          title={t('noUsers')}
          description={t('noUsersDesc')}
          action={{ label: t('browseForecasts'), href: '/' }}
        />
      ) : (
        <div className="bg-navy-700 border border-navy-600 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="bg-navy-800 border-b border-navy-600">
                <th className="px-1.5 sm:px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider break-words w-12 sm:w-16">{t('rank')}</th>
                <th className="px-2 sm:px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider break-words">{t('predictor')}</th>
                {sortHeader('elo', <>
                  {t('sortBy.elo')}
                  {selectedTagName && <span className="block text-[10px] font-medium normal-case tracking-normal text-blue-300 truncate">{selectedTagName}</span>}
                </>)}
                {sortHeader('accuracy', t('sortBy.accuracy'))}
                {sortHeader('brierScore', t('sortBy.brierScore'))}
                {sortHeader('peerScore', t('sortBy.peerScore'))}
                {sortHeader('aiScore', t('sortBy.aiScore'))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/10">
              {displayed.map((user) => { const index = rankById.get(user.id) ?? 0; return (
                <tr
                  key={user.id}
                  onClick={() => router.push(`/profile/${user.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/profile/${user.id}`) } }}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer hover:bg-white/5 focus:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 transition-colors ${index < 3 && sortDir === 'best' ? 'bg-amber-400/5' : ''}`}
                >
                  <td className="px-1.5 sm:px-6 py-3 sm:py-4">
                    <div className="flex justify-center">
                      {getRankIcon(index)}
                    </div>
                  </td>
                  <td className="px-2 sm:px-6 py-3 sm:py-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      {user.image ? (
                        <Image src={user.image} alt="" width={36} height={36} className="rounded-full border border-navy-600 w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                          {user.name?.charAt(0) || user.username?.charAt(0) || '?'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate text-sm sm:text-base">
                          {user.name || user.username || 'Anonymous'}
                        </p>
                        {user.username && (
                          <p className="text-xs text-gray-500 truncate">@{user.username}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-3 sm:py-4 text-right">
                    <span className={valueClass('elo')}>
                      {user.eloRating !== null ? Math.round(user.eloRating) : '—'}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-3 sm:py-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className={valueClass('accuracy')}>
                        {user.accuracy !== null ? `${user.accuracy}%` : '—'}
                      </span>
                      {user.totalResolved > 0 && (
                        <span className="hidden sm:block text-[10px] text-gray-400">
                          {user.totalCorrect}/{user.totalResolved} {t('resolvedLabel')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-3 sm:py-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className={valueClass('brierScore')}>
                        {user.avgBrierScore !== null ? user.avgBrierScore.toFixed(3) : '—'}
                      </span>
                      {user.brierCount > 0 && (
                        <span className="hidden sm:block text-[10px] text-gray-400">
                          {user.brierCount} {t('scoredLabel')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right ${cellVisibility('peerScore')}`}>
                    <span className={valueClass('peerScore')}>{formatSigned(user.peerScoreSum)}</span>
                  </td>
                  <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right ${cellVisibility('aiScore')}`}>
                    <span className={valueClass('aiScore')}>{formatSigned(user.aiScoreSum)}</span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Swords className="w-4 h-4 text-orange-400" />
            {t('legend.eloTitle')}
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">{t('legend.eloDesc')}</p>
        </div>
        <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Target className="w-4 h-4 text-green-500" />
            {t('legend.accuracyTitle')}
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">{t('legend.accuracyDesc')}</p>
        </div>
        <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-purple-500" />
            {t('legend.brierTitle')}
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">{t('legend.brierDesc')}</p>
        </div>
        <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            {t('legend.peerScoreTitle')}
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">{t('legend.peerScoreDesc')}</p>
        </div>
        <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            {t('legend.aiScoreTitle')}
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">{t('legend.aiScoreDesc')}</p>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-gray-500">
        <Link href="/methodology" className="text-blue-400 hover:text-blue-300 underline">
          {t('methodologyLink')}
        </Link>
      </p>
    </div>
  )
}
