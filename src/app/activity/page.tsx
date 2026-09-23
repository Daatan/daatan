'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, Loader2, TrendingUp, CheckCircle2, XCircle, CircleDot, Clock, User } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { createClientLogger } from '@/lib/client-logger'
import { useTranslations } from 'next-intl'
import EmptyState from '@/components/ui/EmptyState'
import { UserLink } from '@/components/UserLink'

const log = createClientLogger('ActivityFeed')

interface ActivityItem {
  id: string
  cuCommitted: number
  binaryChoice: boolean | null
  createdAt: string
  user: {
    id: string
    name: string | null
    username: string | null
    image: string | null
    rs: number
    eloRating: number
  }
  prediction: {
    id: string
    slug: string | null
    claimText: string
    status: string
    outcomeType: string
  }
  option?: {
    id: string
    text: string
  } | null
}

export default function ActivityFeedPage() {
  const t = useTranslations('activity')
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch('/api/commitments/activity?limit=30')
        if (res.ok) {
          const data = await res.json()
          setActivity(data.activity)
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to fetch activity')
      } finally {
        setIsLoading(false)
      }
    }

    fetchActivity()
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    )
  }

  /** Map a commitment into the pieces the UI renders:
   *  verb ("voted" / "picked"), coloured chip (YES / NO / option text),
   *  and a small leading icon (TrendingUp / TrendingDown / CircleDot). */
  const describeAction = (item: ActivityItem) => {
    if (item.option) {
      return {
        verb: t('picked'),
        chipText: item.option.text,
        chipClass: 'bg-cobalt/15 text-blue-400 border-cobalt/30',
        Icon: CircleDot,
        iconClass: 'text-blue-400',
      }
    }
    if (item.binaryChoice === true) {
      return {
        verb: t('voted'),
        chipText: 'YES',
        chipClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        Icon: CheckCircle2,
        iconClass: 'text-emerald-400',
      }
    }
    if (item.binaryChoice === false) {
      return {
        verb: t('voted'),
        chipText: 'NO',
        chipClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        Icon: XCircle,
        iconClass: 'text-rose-400',
      }
    }
    // Fallback for odd data: a commitment with no binary/option (shouldn't happen).
    return {
      verb: t('participated'),
      chipText: '—',
      chipClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
      Icon: CircleDot,
      iconClass: 'text-gray-400',
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6">{t('subtitle')}</p>

      {activity.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={<Activity className="w-12 h-12 text-gray-300" />}
          description={t('noActivity')}
        />
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-navy-700" aria-hidden="true" />

          <div className="space-y-0">
            {activity.map((item) => (
              <div key={item.id} className="relative flex gap-4 pb-6 group">
                {/* Timeline dot */}
                <div className="relative z-10 shrink-0">
                  <UserLink 
                    userId={item.user.id}
                    username={item.user.username}
                    name={item.user.name}
                    image={item.user.image}
                    showAvatar={true}
                    avatarSize={32}
                    className="w-10 h-10 rounded-full bg-navy-700 border-2 border-navy-600 flex items-center justify-center group-hover:border-blue-300 transition-colors"
                  >
                    {!item.user.image && <User className="w-5 h-5 text-gray-400" />}
                  </UserLink>
                </div>

                {/* Content */}
                {(() => {
                  const action = describeAction(item)
                  return (
                    <div className="flex-1 bg-navy-700 rounded-xl border border-navy-600 p-4 hover:border-cobalt/30 hover:shadow-sm transition-all">
                      {/* Action line: user + verb + coloured choice chip + CU + timestamp */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap text-sm text-text-secondary">
                          <action.Icon className={`w-4 h-4 shrink-0 ${action.iconClass}`} />
                          <UserLink
                            userId={item.user.id}
                            username={item.user.username}
                            name={item.user.name}
                            className="font-semibold text-white"
                          />
                          <span>{action.verb}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${action.chipClass}`}>
                            {action.chipText}
                          </span>
                          <span className="text-gray-500">·</span>
                          <span className="font-semibold text-amber-400">
                            {item.binaryChoice !== null
                              ? Math.round((item.cuCommitted + 100) / 2)
                              : Math.abs(item.cuCommitted)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </div>
                      </div>

                      {/* Primary title: the actual forecast claim, linked to detail page */}
                      <Link
                        href={`/forecasts/${item.prediction.slug || item.prediction.id}`}
                        className="block text-base font-medium text-white hover:text-blue-400 line-clamp-2 transition-colors"
                      >
                        {item.prediction.claimText}
                      </Link>

                      <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                        <TrendingUp className="w-3 h-3" />
                        <span>ELO {Math.round(item.user.eloRating)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
