'use client'

import { Fragment, useEffect, useState, useCallback, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Trophy, Loader2, Target, TrendingDown, Swords, Bot, Users } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { BODY, BoardTabs, ColumnHint, HEAD_CELL, HEAD_ROW, LEGEND_GRID, LegendCard, LowerIsBetter, RankBadge, TABLE_CARD, pillClass } from '@/components/leaderboard/LeaderboardParts'
import { createClientLogger } from '@/lib/client-logger'
import { useTranslations } from 'next-intl'
import { FETCH_LIMIT, INITIAL_SORT, LOWER_IS_BETTER, MIN_RANKED_RESOLVED, formatSigned, isLowSample, orderForDisplay, type LeaderboardUser, type SortBy, type SortDir } from './sort'

const log = createClientLogger('Leaderboard')

export type TagOption = { name: string; slug: string }

const profileHref = (user: LeaderboardUser) => `/profile/${user.username ?? user.id}`

export default function LeaderboardClient({ initialUsers, initialTags, initialTag }: {
  initialUsers: LeaderboardUser[]
  initialTags: TagOption[]
  initialTag: string | null
}) {
  const t = useTranslations('leaderboard')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [users, setUsers] = useState<LeaderboardUser[]>(initialUsers)
  const tags = initialTags
  const [sortBy, setSortBy] = useState<SortBy>(INITIAL_SORT)
  const [sortDir, setSortDir] = useState<SortDir>('best')
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag)

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

  // Rank = position among the users who qualify, in the API's best-first order.
  const rankById = new Map(users.filter(u => !isLowSample(u)).map((u, i) => [u.id, i]))
  const displayed = orderForDisplay(users, sortBy, sortDir)

  const fetchLeaderboardKey = `${sortBy}|${selectedTag}`
  const [fetchLeaderboardLoadedKey, setFetchLeaderboardLoadedKey] = useState<string | null>(`${INITIAL_SORT}|${initialTag}`)
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

  // The server already rendered the initial key; fetch only when sort or topic changes.
  useEffect(() => {
    if (isLoading) fetchLeaderboard()
  }, [fetchLeaderboard, isLoading])

  // Sync tag to URL
  const handleTagChange = (slug: string | null) => {
    setSelectedTag(slug)
    const params = new URLSearchParams(searchParams.toString())
    if (slug) params.set('tag', slug)
    else params.delete('tag')
    // replaceState, not router.replace: the client fetch below loads the new topic, so a
    // server re-render of the page would only duplicate it.
    window.history.replaceState(null, '', `${pathname}?${params}`)
  }

  const selectedTagName = selectedTag
    ? (tags.find(tag => tag.slug === selectedTag)?.name ?? selectedTag)
    : null

  // The two extra columns only fit from sm up; the active one always shows.
  const isExtra = (key: SortBy) => key === 'peerScore' || key === 'aiScore'
  const cellVisibility = (key: SortBy) => (isExtra(key) && sortBy !== key ? 'hidden sm:table-cell' : '')

  const headerClass = (key: SortBy) =>
    `px-1 sm:px-4 ${HEAD_CELL} text-right w-16 ${key === 'brierScore' ? 'sm:w-28' : 'sm:w-24'} ${cellVisibility(key)} ${
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

  // The arrow sits on the label; `sub` (topic name, "lower is better") goes on its own line below.
  const sortHeader = (sortKey: SortBy, label: string, sub?: ReactNode) => (
    <th className={`${headerClass(sortKey)} relative group`} aria-sort={ariaSort(sortKey)}>
      <button
        type="button"
        onClick={() => handleSort(sortKey)}
        aria-describedby={`lb-hint-${sortKey}`}
        className="uppercase tracking-wider font-bold text-right hover:text-white transition-colors"
      >
        {label}
        {sortArrow(sortKey)}
        {sub}
      </button>
      <ColumnHint id={`lb-hint-${sortKey}`}>{t(HINT_KEY[sortKey])}</ColumnHint>
    </th>
  )

  const valueClass = (key: SortBy) =>
    sortBy === key ? 'font-black text-white text-base sm:text-lg' : 'font-bold text-text-secondary text-sm'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <BoardTabs
        active="users"
        ariaLabel={t('boards.nav')}
        labels={{ users: t('boards.users'), ai: t('boards.ai'), sources: t('boards.sources'), versus: t('boards.versus') }}
      />

      {/* Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="p-4 bg-amber-900/20 rounded-2xl mb-4">
          <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-yellow-500" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-2 tracking-tight">{t('title')}</h1>
        <p className="text-gray-500 max-w-md">{t('subtitle')}</p>
      </div>

      {/* Sort Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => handleSort(value)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
              sortBy === value
                ? 'bg-blue-600 text-white shadow-xs'
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
          <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">{t('filterByTopic')}:</span>
          <button
            onClick={() => handleTagChange(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${pillClass(!selectedTag)}`}
          >
            {t('allTopics')}
          </button>
          {tags.map(tag => (
            <button
              key={tag.slug}
              onClick={() => handleTagChange(selectedTag === tag.slug ? null : tag.slug)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${pillClass(selectedTag === tag.slug)}`}
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
        <div className={`${TABLE_CARD} overflow-hidden`}>
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className={HEAD_ROW}>
                <th className="px-1 sm:px-4 py-4 text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider text-center w-10 sm:w-20">
                  {/* "#" on phones: the word does not fit the narrow rank column. */}
                  <span className="sm:hidden" aria-hidden="true">#</span>
                  <span className="sr-only sm:not-sr-only">{t('rank')}</span>
                </th>
                <th className="px-2 sm:px-6 py-4 text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider truncate">{t('predictor')}</th>
                {sortHeader('elo', t('sortBy.elo'),
                  selectedTagName && <span className="block text-[10px] font-medium normal-case tracking-normal text-blue-300 truncate">{selectedTagName}</span>)}
                {sortHeader('accuracy', t('sortBy.accuracy'))}
                {sortHeader('brierScore', t('sortBy.brierScore'), <LowerIsBetter label={t('lowerIsBetter')} />)}
                {sortHeader('peerScore', t('sortBy.peerScore'))}
                {sortHeader('aiScore', t('sortBy.aiScore'))}
              </tr>
            </thead>
            <tbody className={BODY}>
              {displayed.map((user, row) => { const index = rankById.get(user.id); const lowSample = index === undefined; return (
                <Fragment key={user.id}>
                {lowSample && (row === 0 || !isLowSample(displayed[row - 1])) && (
                  <tr className="bg-navy-800">
                    <td colSpan={7} className="px-4 sm:px-6 py-2 text-xs text-gray-500">
                      {t('lowSampleSection', { min: MIN_RANKED_RESOLVED })}
                    </td>
                  </tr>
                )}
                <tr
                  onClick={() => router.push(profileHref(user))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(profileHref(user)) } }}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer hover:bg-white/5 focus:bg-white/5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 transition-colors ${index !== undefined && index < 3 && sortDir === 'best' ? 'bg-amber-400/5' : ''} ${lowSample ? 'opacity-70' : ''}`}
                >
                  <td className="px-1 sm:px-4 py-3 sm:py-4">
                    <div className="flex justify-center">
                      {lowSample ? <span className="text-gray-600" aria-hidden="true">·</span> : <RankBadge rank={index} />}
                    </div>
                  </td>
                  <td className="px-2 sm:px-6 py-3 sm:py-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      {user.image ? (
                        <Image src={user.image} alt="" width={36} height={36} className="rounded-full border border-navy-600 w-8 h-8 sm:w-10 sm:h-10 shrink-0" />
                      ) : (
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                          {user.name?.charAt(0) || user.username?.charAt(0) || '?'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate text-sm sm:text-base">
                          <Link href={profileHref(user)} onClick={e => e.stopPropagation()} className="hover:underline">
                            {user.name || user.username || 'Anonymous'}
                          </Link>
                          {lowSample && (
                            <span
                              className="ms-2 align-middle inline-block px-1.5 py-0.5 rounded-sm bg-navy-600 text-[10px] font-medium text-gray-400"
                              title={t('lowSampleHint', { min: MIN_RANKED_RESOLVED })}
                            >
                              {t('lowSampleBadge')}
                            </span>
                          )}
                        </p>
                        {user.username && (
                          <p className="text-xs text-gray-500 truncate"><bdi>@{user.username}</bdi></p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-1 sm:px-4 py-3 sm:py-4 text-right">
                    <span className={valueClass('elo')}>
                      {user.eloRating !== null ? Math.round(user.eloRating) : '—'}
                    </span>
                  </td>
                  <td className="px-1 sm:px-4 py-3 sm:py-4 text-right">
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
                  <td className="px-1 sm:px-4 py-3 sm:py-4 text-right">
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
                  <td className={`px-1 sm:px-4 py-3 sm:py-4 text-right ${cellVisibility('peerScore')}`}>
                    <span dir="ltr" className={valueClass('peerScore')}>{formatSigned(user.peerScoreSum)}</span>
                  </td>
                  <td className={`px-1 sm:px-4 py-3 sm:py-4 text-right ${cellVisibility('aiScore')}`}>
                    <span dir="ltr" className={valueClass('aiScore')}>{formatSigned(user.aiScoreSum)}</span>
                  </td>
                </tr>
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className={LEGEND_GRID}>
        <LegendCard icon={<Swords className="w-4 h-4 text-orange-400" />} title={t('legend.eloTitle')}>{t('legend.eloDesc')}</LegendCard>
        <LegendCard icon={<Target className="w-4 h-4 text-green-500" />} title={t('legend.accuracyTitle')}>{t('legend.accuracyDesc')}</LegendCard>
        <LegendCard icon={<TrendingDown className="w-4 h-4 text-purple-500" />} title={t('legend.brierTitle')}>{t('legend.brierDesc')}</LegendCard>
        <LegendCard icon={<Users className="w-4 h-4 text-cyan-400" />} title={t('legend.peerScoreTitle')}>{t('legend.peerScoreDesc')}</LegendCard>
        <LegendCard icon={<Bot className="w-4 h-4 text-cyan-400" />} title={t('legend.aiScoreTitle')}>{t('legend.aiScoreDesc')}</LegendCard>
      </div>
      <p className="mt-4 text-center text-xs text-gray-500">
        <Link href="/methodology" className="text-blue-400 hover:text-blue-300 underline">
          {t('methodologyLink')}
        </Link>
      </p>
    </div>
  )
}
