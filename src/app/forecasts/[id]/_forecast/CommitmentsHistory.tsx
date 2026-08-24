'use client'
import { useState } from 'react'
import { Users, Trash2, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { UserLink } from '@/components/UserLink'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  currentUserId?: string
  authorId?: string
  onRemove?: () => void
}

function toPct(cuCommitted: number): number {
  return Math.round((cuCommitted + 100) / 2)
}

type Commitment = Prediction['commitments'][number]

function VoterRow({
  commitment,
  pct,
  isCurrentUser,
  isAuthor,
  canRemove,
  isConfirming,
  isRemoving,
  removeError,
  onStartConfirm,
  onConfirmRemove,
  onCancelConfirm,
  t,
}: {
  commitment: Commitment
  pct: number
  isCurrentUser: boolean
  isAuthor: boolean
  canRemove: boolean
  isConfirming: boolean
  isRemoving: boolean
  removeError: string | null
  onStartConfirm: () => void
  onConfirmRemove: () => void
  onCancelConfirm: () => void
  t: ReturnType<typeof useTranslations<'forecast'>>
}) {
  const rsChange = commitment.rsChange
  const isResolved = rsChange !== null && rsChange !== undefined

  return (
    <div className={`p-3 rounded-lg ${isCurrentUser ? 'bg-blue-900/10 border border-blue-800/30' : 'bg-navy-800/40'}`}>
      <div className="flex items-center justify-between gap-2">
        <UserLink
          userId={commitment.user.id}
          username={commitment.user.username}
          name={commitment.user.name}
          image={commitment.user.image}
          showAvatar={true}
          avatarSize={28}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium text-white text-sm truncate">{commitment.user.name}</span>
            {isCurrentUser && (
              <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/50 shrink-0">
                {t('youBadge')}
              </span>
            )}
            {isAuthor && (
              <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-900/30 text-amber-300/90 border border-amber-700/40 shrink-0 uppercase tracking-wide">
                {t('author')}
              </span>
            )}
          </div>
        </UserLink>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-bold text-gray-200">{pct}%</span>
          {isResolved && (
            <span className={`text-xs font-medium ${rsChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {rsChange >= 0 ? '+' : ''}{rsChange}
            </span>
          )}
          {canRemove && !isConfirming && (
            <button
              onClick={onStartConfirm}
              className="p-1 rounded text-red-500 hover:bg-red-900/20 transition-colors"
              aria-label="Remove vote"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {isCurrentUser && isConfirming && (
        <div className="mt-2 rounded border border-red-800/50 bg-red-900/10 p-2">
          <p className="text-xs text-red-300 mb-1.5">Remove your vote? This cannot be undone.</p>
          {removeError && <p className="text-xs text-red-400 mb-1.5">{removeError}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={onConfirmRemove}
              disabled={isRemoving}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {isRemoving && <Loader2 className="w-3 h-3 animate-spin" />}
              {isRemoving ? 'Removing...' : 'Confirm'}
            </button>
            <button
              onClick={onCancelConfirm}
              disabled={isRemoving}
              className="flex-1 rounded border border-gray-600 px-2 py-1 text-xs font-semibold text-gray-300 hover:bg-navy-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function CommitmentsHistory({ prediction, currentUserId, authorId, onRemove }: Props) {
  const t = useTranslations('forecast')
  const [isRemoving, setIsRemoving] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  if (prediction.commitments.length === 0) return null

  const confirmRemove = async () => {
    setIsRemoving(true)
    setRemoveError(null)
    try {
      const response = await fetch(`/api/forecasts/${prediction.id}/commit`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to remove commitment')
      onRemove?.()
    } catch {
      setRemoveError('Failed to remove. Please try again.')
    } finally {
      setIsRemoving(false)
      setIsConfirming(false)
    }
  }

  const isBinary = prediction.outcomeType === 'BINARY'

  if (isBinary) {
    const sortByConfidence = (a: Commitment, b: Commitment, ascending = false) => {
      if (a.user.id === currentUserId) return -1
      if (b.user.id === currentUserId) return 1
      const diff = toPct(b.cuCommitted) - toPct(a.cuCommitted)
      return ascending ? -diff : diff
    }

    const yesSide = prediction.commitments
      .filter(c => c.binaryChoice === true)
      .sort((a, b) => sortByConfidence(a, b))

    const noSide = prediction.commitments
      .filter(c => c.binaryChoice === false)
      .sort((a, b) => sortByConfidence(a, b, true))

    return (
      <div className="mt-12">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          {t('forecastsHistory')}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          {/* YES column */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-xs font-bold uppercase tracking-widest text-teal">
                {t('willHappen')}
              </span>
              <span className="text-xs font-bold text-teal bg-teal/10 px-1.5 py-0.5 rounded-full border border-teal/20">
                {yesSide.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {yesSide.length === 0 ? (
                <p className="text-xs text-gray-500 px-1">—</p>
              ) : (
                yesSide.map(c => (
                  <VoterRow
                    key={c.id}
                    commitment={c}
                    pct={toPct(c.cuCommitted)}
                    isCurrentUser={c.user.id === currentUserId}
                    isAuthor={c.user.id === authorId}
                    canRemove={c.user.id === currentUserId && prediction.status === 'ACTIVE' && !!onRemove}
                    isConfirming={isConfirming && c.user.id === currentUserId}
                    isRemoving={isRemoving}
                    removeError={removeError}
                    onStartConfirm={() => setIsConfirming(true)}
                    onConfirmRemove={confirmRemove}
                    onCancelConfirm={() => setIsConfirming(false)}
                    t={t}
                  />
                ))
              )}
            </div>
          </div>

          {/* NO column */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-xs font-bold uppercase tracking-widest text-red-400">
                {t('wontHappen')}
              </span>
              <span className="text-xs font-bold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full border border-red-400/20">
                {noSide.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {noSide.length === 0 ? (
                <p className="text-xs text-gray-500 px-1">—</p>
              ) : (
                noSide.map(c => (
                  <VoterRow
                    key={c.id}
                    commitment={c}
                    pct={toPct(c.cuCommitted)}
                    isCurrentUser={c.user.id === currentUserId}
                    isAuthor={c.user.id === authorId}
                    canRemove={c.user.id === currentUserId && prediction.status === 'ACTIVE' && !!onRemove}
                    isConfirming={isConfirming && c.user.id === currentUserId}
                    isRemoving={isRemoving}
                    removeError={removeError}
                    onStartConfirm={() => setIsConfirming(true)}
                    onConfirmRemove={confirmRemove}
                    onCancelConfirm={() => setIsConfirming(false)}
                    t={t}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Multiple choice — flat list unchanged
  const sorted = [...prediction.commitments].sort((a, b) => {
    if (a.user.id === currentUserId) return -1
    if (b.user.id === currentUserId) return 1
    return 0
  })

  return (
    <div className="mt-12">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Users className="w-5 h-5" />
        {t('forecastsHistory')}
      </h2>
      <div className="border border-navy-600 rounded-lg divide-y divide-navy-600">
        {sorted.map((commitment) => {
          const isCurrentUser = commitment.user.id === currentUserId
          const pct = Math.round(commitment.cuCommitted)
          const direction = commitment.option?.text ?? ''
          const rsChange = commitment.rsChange
          const isResolved = rsChange !== null && rsChange !== undefined

          return (
            <div key={commitment.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <UserLink
                  userId={commitment.user.id}
                  username={commitment.user.username}
                  name={commitment.user.name}
                  image={commitment.user.image}
                  showAvatar={true}
                  avatarSize={32}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{commitment.user.name}</span>
                    {isCurrentUser && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/50">
                        {t('youBadge')}
                      </span>
                    )}
                    {commitment.user.id === authorId && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300/90 border border-amber-700/40 uppercase tracking-wide">
                        {t('author')}
                      </span>
                    )}
                  </div>
                </UserLink>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="text-sm font-semibold text-cobalt-light">{direction}</span>
                    <span className="text-sm text-gray-400 ml-1">· {pct}%</span>
                  </div>
                  {isCurrentUser && prediction.status === 'ACTIVE' && onRemove && !isConfirming && (
                    <button
                      onClick={() => setIsConfirming(true)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-900/20 transition-colors"
                      aria-label="Remove vote"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {isResolved && (
                <div className="mt-1.5 ml-10">
                  <span className={`text-xs font-medium ${rsChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {rsChange >= 0 ? '+' : ''}{rsChange} RS
                  </span>
                </div>
              )}
              {isCurrentUser && isConfirming && (
                <div className="mt-3 rounded-lg border border-red-800/50 bg-red-900/10 p-3">
                  <p className="text-sm text-red-300 mb-2">Remove your vote? This cannot be undone.</p>
                  {removeError && <p className="text-xs text-red-400 mb-2">{removeError}</p>}
                  <div className="flex gap-2">
                    <button onClick={confirmRemove} disabled={isRemoving}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                      {isRemoving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {isRemoving ? 'Removing...' : 'Confirm remove'}
                    </button>
                    <button onClick={() => setIsConfirming(false)} disabled={isRemoving}
                      className="flex-1 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-navy-800 transition-colors disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
