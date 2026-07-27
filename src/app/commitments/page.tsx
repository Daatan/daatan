'use client'

import React from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('CommitmentsPage')
import { 
  History, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  Clock, 
  CheckCircle2, 
  XCircle,
  HelpCircle,
  ArrowRight
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { he, enUS } from 'date-fns/locale'
import { useSession } from 'next-auth/react'
import EmptyState from '@/components/ui/EmptyState'
import { PrimaryLink } from '@/components/ui/PrimaryLink'

interface Commitment {
  id: string
  cuCommitted: number
  createdAt: string
  prediction: {
    id: string
    claimText: string
    status: string
    outcomeType: string
    resolvedAt: string | null
    winningOptionId: string | null
  }
}

export default function CommitmentsPage() {
  const t = useTranslations('commitment')
  const tf = useTranslations('forecast')
  const { data: session } = useSession()
  const [commitments, setCommitments] = React.useState<Commitment[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!session) {
      setLoading(false)
      return
    }

    async function fetchCommitments() {
      try {
        const response = await fetch('/api/commitments')
        if (response.ok) {
          const data = await response.json()
          setCommitments(data.commitments ?? [])
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to fetch commitments')
      } finally {
        setLoading(false)
      }
    }

    fetchCommitments()
  }, [session])

  const locale = useLocale() === 'he' ? he : enUS

  const predictionStatusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT': return tf('draft')
      case 'ACTIVE': return tf('active')
      case 'PENDING': return tf('pending')
      case 'PENDING_APPROVAL': return tf('pendingApproval')
      case 'RESOLVED_CORRECT': return tf('correct')
      case 'RESOLVED_WRONG': return tf('wrong')
      case 'VOID': return tf('void')
      case 'UNRESOLVABLE': return tf('unresolvable')
      default: return status
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-navy-600 rounded w-1/4 mb-8"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-navy-700 rounded-xl"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center gap-2 mb-8">
        <History className="w-8 h-8 text-blue-600" />
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      {!commitments || commitments.length === 0 ? (
        <EmptyState
          title={t('noCommitments')}
          icon={<History className="w-12 h-12 text-gray-300" />}
          description={
            <>
              <span className="block">{t('noCommitmentsDesc')}</span>
              <span className="block text-sm mt-1">
                <PrimaryLink href="/">{t('browseFeed')}</PrimaryLink>
              </span>
            </>
          }
        />
      ) : (
        <div className="space-y-4">
          {commitments.map((commitment) => (
            <div 
              key={commitment.id}
              className="bg-navy-700 border border-navy-600 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        commitment.prediction.status === 'ACTIVE'
                          ? 'bg-cobalt/10 text-cobalt-light border border-cobalt/20'
                          : commitment.prediction.status === 'RESOLVED_CORRECT' || commitment.prediction.status === 'RESOLVED_WRONG'
                            ? 'bg-teal/10 text-teal border border-teal/20'
                            : 'bg-navy-800 text-gray-400 border border-navy-600'
                      }`}>
                        {predictionStatusLabel(commitment.prediction.status)}
                      </span>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(commitment.createdAt), { addSuffix: true, locale })}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold line-clamp-2 mb-2 group">
                      <PrimaryLink 
                        href={`/forecasts/${commitment.prediction.id}`}
                        className="text-white hover:text-blue-600"
                        underline="none"
                      >
                        {commitment.prediction.claimText}
                      </PrimaryLink>
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 bg-navy-800 p-3 rounded-lg border border-navy-600">
                    <div className="flex flex-col items-center min-w-[60px]">
                      <span className="text-[10px] uppercase font-bold text-gray-400 leading-none mb-1">Confidence</span>
                      <div className="flex items-center gap-1">
                        <ArrowUpCircle className="w-4 h-4 text-blue-500" />
                        <span className="text-lg font-bold text-white">
                          {commitment.prediction.outcomeType === 'BINARY'
                            ? Math.round((commitment.cuCommitted + 100) / 2)
                            : Math.abs(commitment.cuCommitted)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Add more info here if needed */}
                  </div>
                  <PrimaryLink 
                    href={`/forecasts/${commitment.prediction.id}`}
                    size="xs"
                    className="flex items-center gap-1 font-bold uppercase tracking-wider text-blue-600 hover:text-cobalt-light"
                  >
                    {t('viewPrediction')}
                    <ArrowRight className="w-3 h-3" />
                  </PrimaryLink>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
