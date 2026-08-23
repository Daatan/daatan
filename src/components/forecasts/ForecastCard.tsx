'use client'

import type { UserRole } from '@prisma/client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { createClientLogger } from '@/lib/client-logger'
import { toast } from 'react-hot-toast'
import { useTranslations, useLocale } from 'next-intl'
import {
  Calendar,
  Users,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  Trash2,
  Edit2,
  Gavel,
  Lock,
  EyeOff,
  MoreHorizontal,
  Languages,
  Loader2,
  PenLine,
} from 'lucide-react'
import { UserLink } from '@/components/UserLink'
import Speedometer from './Speedometer'

export type Prediction = {
  id: string
  slug?: string | null
  claimText: string
  outcomeType: string
  status: string
  lockedAt?: string | Date | null
  resolveByDatetime: string | Date
  author: {
    id: string
    name: string | null
    username?: string | null
    image?: string | null
    rs?: number
    role?: UserRole
  }
  newsAnchor?: {
    id: string
    title: string
    source?: string | null
    imageUrl?: string | null
  } | null
  isPublic?: boolean
  source?: string | null
  tags?: { name: string; slug?: string }[]
  options?: Array<{
    id: string
    text: string
    isCorrect?: boolean | null
    commitmentsCount?: number
  }>
  _count: {
    commitments: number
  }
  totalCuCommitted?: number
  userHasCommitted?: boolean
  yesCount?: number
  noCount?: number
  communityProbability?: number | null
  confidence?: number | null
  aiCiLow?: number | null
  aiCiHigh?: number | null
  /** daatan#1318: AI moderation check errored instead of returning a verdict — needs manual review. */
  moderationCheckFailed?: boolean | null
}

interface ForecastCardProps {
  prediction: Prediction
  showModerationControls?: boolean
  onMutated?: (id: string) => void
}

export default function ForecastCard({
  prediction,
  showModerationControls = false,
  onMutated,
}: ForecastCardProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations('forecast')
  const tt = useTranslations('translate')
  const locale = useLocale()
  const [isApproving, setIsApproving] = useState(false)
  const [showAdminMenu, setShowAdminMenu] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Translation state
  const [translatedClaim, setTranslatedClaim] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [showTranslated, setShowTranslated] = useState(locale !== 'en')

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (locale === 'en' || !prediction.id || translatedClaim) return

    const triggerTranslation = async () => {
      setIsTranslating(true)
      try {
        const response = await fetch(`/api/forecasts/${prediction.id}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: locale }),
        })
        if (response.ok) {
          const data = await response.json()
          if (data.claimText) {
            setTranslatedClaim(data.claimText)
          }
        }
      } catch (err) {
        // Silent error for feed cards
      } finally {
        setIsTranslating(false)
      }
    }

    triggerTranslation()
  }, [prediction.id, locale, translatedClaim])

  const canAdminister =
    showModerationControls && session?.user?.role === 'ADMIN'
  const canResolve =
    showModerationControls &&
    (session?.user?.role === 'RESOLVER' || session?.user?.role === 'ADMIN') &&
    (prediction.status === 'ACTIVE' || prediction.status === 'PENDING')
  const canApprove =
    showModerationControls &&
    prediction.status === 'PENDING_APPROVAL' &&
    (session?.user?.role === 'ADMIN' || session?.user?.role === 'APPROVER')

  const isLocked = !!prediction.lockedAt
  const isEditable =
    (prediction.status === 'DRAFT' ||
      prediction.status === 'ACTIVE' ||
      prediction.status === 'PENDING') &&
    (!isLocked || session?.user?.role === 'ADMIN')

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(t('deleteConfirm'))) return

    try {
      const response = await fetch(`/api/forecasts/${prediction.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        router.refresh()
        toast.success(t('deleteSuccess'))
      } else {
        toast.error(t('deleteError'))
      }
    } catch (error) {
      createClientLogger('ForecastCard').error({ err: error }, 'Error deleting forecast')
      toast.error(t('deleteError'))
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    router.push(`/forecasts/${prediction.slug || prediction.id}/edit`)
  }

  const handleResolve = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    router.push(`/forecasts/${prediction.slug || prediction.id}`)
  }

  const handleApprove = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsApproving(true)
    try {
      const response = await fetch(`/api/admin/forecasts/${prediction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      if (response.ok) {
        toast.success(t('approveSuccess'))
        onMutated?.(prediction.id)
        router.refresh()
      } else {
        toast.error(t('approveError'))
        setIsApproving(false)
      }
    } catch (error) {
      createClientLogger('ForecastCard').error({ err: error }, 'Error approving forecast')
      toast.error(t('approveError'))
      setIsApproving(false)
    }
  }

  const handleReject = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(t('rejectConfirm'))) return
    try {
      const response = await fetch(`/api/admin/forecasts/${prediction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'VOID' }),
      })
      if (response.ok) {
        toast.success(t('rejectSuccess'))
        onMutated?.(prediction.id)
        router.refresh()
      } else {
        toast.error(t('rejectError'))
      }
    } catch (error) {
      createClientLogger('ForecastCard').error({ err: error }, 'Error rejecting forecast')
      toast.error(t('rejectError'))
    }
  }

  useEffect(() => {
    if (!showAdminMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAdminMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, { passive: true })
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAdminMenu])

  const formatDate = (date: string | Date) => {
    if (!isMounted) return ''
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return {
          icon: <Clock className="w-3 h-3" />,
          className: 'bg-navy-700 text-text-secondary',
          label: t('draft'),
          hint: t('statusHints.draft')
        }
      case 'ACTIVE':
        return {
          icon: <TrendingUp className="w-3 h-3" />,
          className: 'bg-green-100 text-teal',
          label: t('active'),
          hint: t('statusHints.active')
        }
      case 'PENDING':
        return {
          icon: <AlertCircle className="w-3 h-3" />,
          className: 'bg-yellow-100 text-yellow-700',
          label: t('pending'),
          hint: t('statusHints.pending')
        }
      case 'PENDING_APPROVAL':
        return {
          icon: <Clock className="w-3 h-3" />,
          className: 'bg-amber-100 text-amber-400',
          label: t('pendingApproval'),
          hint: t('statusHints.pendingApproval')
        }
      case 'RESOLVED_CORRECT':
        return {
          icon: <CheckCircle2 className="w-3 h-3" />,
          className: 'bg-blue-100 text-cobalt-light',
          label: t('correct'),
          hint: t('statusHints.correct')
        }
      case 'RESOLVED_WRONG':
        return {
          icon: <XCircle className="w-3 h-3" />,
          className: 'bg-red-100 text-red-400',
          label: t('wrong'),
          hint: t('statusHints.wrong')
        }
      case 'UNRESOLVABLE':
      case 'VOID':
        return {
          icon: <HelpCircle className="w-3 h-3" />,
          className: 'bg-orange-100 text-orange-700',
          label: status === 'VOID' ? t('void') : t('unresolvable'),
          hint: status === 'VOID' ? t('statusHints.void') : t('statusHints.unresolvable')
        }
      default:
        return {
          icon: <Clock className="w-3 h-3" />,
          className: 'bg-navy-700 text-text-secondary',
          label: status,
          hint: status
        }
    }
  }

  const badge = getStatusBadge(prediction.status)
  const forecastUrl = `/forecasts/${prediction.slug || prediction.id}`
  const showMenu = !canApprove && (canAdminister || canResolve)

  return (
    <div className="group relative block p-4 sm:p-5 bg-navy-700 border border-navy-600 rounded-xl hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer">
      {/* Stretched overlay link: makes the whole card a real anchor, so
          Ctrl/Cmd/middle-click open it in a (background) tab and right-click
          offers "open in new tab". Interactive children sit above it via z-[2]. */}
      <Link
        href={forecastUrl}
        aria-label={prediction.claimText}
        className="absolute inset-0 z-[1]"
      />

      {/* Pinned to the card corner rather than given its own flex column, so the
          claim text and the footer rule can run the full width of the card. The
          header row reserves space for it with pr-7. */}
      {showMenu && (
        <div className="absolute right-3 top-3 z-[2]" ref={menuRef}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAdminMenu(v => !v) }}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-navy-800 transition-colors"
            aria-label="Admin actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showAdminMenu && (
            <div className="absolute right-0 top-7 z-10 bg-navy-700 border border-navy-600 rounded-lg shadow-lg py-1 min-w-[120px]">
              {canResolve && (
                <button
                  onClick={handleResolve}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-navy-800 transition-colors"
                >
                  <Gavel className="w-3.5 h-3.5" />
                  {t('resolve')}
                </button>
              )}
              {canAdminister && isEditable && (
                <button
                  onClick={handleEdit}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-navy-800 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {t('edit')}
                </button>
              )}
              {canAdminister && (
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('delete')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Header: Status, Confidence, Deadline */}
          <div className={`flex items-center flex-wrap gap-2 mb-4 ${showMenu ? 'pr-7' : ''}`}>
            {prediction.status !== 'ACTIVE' && (
              <span
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider ${badge.className}`}
                title={badge.hint}
              >
                {badge.icon}
                {badge.label}
              </span>
            )}

            {showModerationControls && prediction.moderationCheckFailed && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-red-100 text-red-700"
                title="AI moderation check failed for this content — review it manually"
              >
                <AlertCircle className="w-3 h-3" />
                Needs review
              </span>
            )}

            {/* Resolve By Date (Deadline) - Moved to top */}
            {(() => {
              const daysUntil = Math.ceil((new Date(prediction.resolveByDatetime).getTime() - Date.now()) / 86400000)
              const dateClass = prediction.status === 'ACTIVE'
                ? daysUntil <= 3 ? 'text-red-500' : daysUntil <= 7 ? 'text-amber-500' : 'text-gray-400'
                : 'text-gray-400'
              return (
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-navy-600 bg-navy-800 ${dateClass}`}
                  title={t('resolveByTooltip')}
                >
                  <Calendar className="w-3 h-3" />
                  <span suppressHydrationWarning>{formatDate(prediction.resolveByDatetime)}</span>
                </div>
              )
            })()}

            {/* Confidence Level (Speedometer) - Moved to top */}
            {prediction.status === 'ACTIVE' && (
              <div className="flex items-center">
                {prediction._count.commitments > 0 && prediction.outcomeType === 'BINARY' && prediction.communityProbability != null && (
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-navy-600 bg-navy-800 text-teal"
                    title={t('communityProbabilityTooltip')}
                  >
                    <TrendingUp className="w-3 h-3" />
                    <span>{prediction.communityProbability}%</span>
                  </div>
                )}
                {prediction.outcomeType === 'MULTIPLE_CHOICE' && prediction.options && prediction.options.length > 0 && prediction._count.commitments > 0 && (() => {
                  const sortedOptions = [...prediction.options].sort((a, b) => (b.commitmentsCount || 0) - (a.commitmentsCount || 0))
                  const topOption = sortedOptions[0]
                  const pct = Math.round(((topOption.commitmentsCount || 0) / prediction._count.commitments) * 100)
                  return (
                    <div
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-navy-600 bg-navy-800 text-teal"
                      title={t('topOptionShareTooltip', { text: topOption.text, pct })}
                    >
                      <TrendingUp className="w-3 h-3" />
                      <span>{pct}%</span>
                    </div>
                  )
                })()}
              </div>
            )}

            {prediction._count.commitments > 0 && (() => {
              const n = prediction._count.commitments
              const cu = prediction.totalCuCommitted
              const titleKey = cu && cu > 0
                ? (n === 1 ? 'voterWithStake' : 'votersWithStake')
                : (n === 1 ? 'voter' : 'voters')
              return (
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-navy-600 bg-navy-800 text-gray-300"
                  title={t(titleKey, { count: n, cu: cu ?? 0 })}
                >
                  <Users className="w-3 h-3" />
                  {n}
                </span>
              )
            })()}
            {prediction.status === 'ACTIVE' && prediction.confidence != null && (() => {
              const hasRange = prediction.aiCiLow != null && prediction.aiCiHigh != null && prediction.aiCiHigh > prediction.aiCiLow
              const spread = hasRange ? Math.round((prediction.aiCiHigh! - prediction.aiCiLow!) / 2) : 0
              const titleKey = hasRange ? 'aiEstimateWithCiTooltip' : 'aiEstimateTooltip'
              return (
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-amber-500/30 bg-amber-500/10 text-amber-400"
                  title={t(titleKey, {
                    probability: prediction.confidence,
                    spread,
                  })}
                >
                  AI: {hasRange ? `${prediction.confidence}±${spread}%` : `${prediction.confidence}%`}
                </span>
              )
            })()}
            {prediction.tags && prediction.tags.length > 0 && (
              <>
                {prediction.tags.slice(0, 2).map((tag) => (
                  <Link
                    key={tag.name}
                    href={tag.slug ? `/tags/${tag.slug}` : `/?tags=${encodeURIComponent(tag.name)}`}
                    prefetch={false}
                    title={t('filterByTagTooltip', { tag: tag.name })}
                    className="relative z-[2] px-2 py-0.5 bg-cobalt/10 text-cobalt-light hover:bg-cobalt/20 text-[10px] sm:text-xs font-medium rounded-full border border-cobalt/20 transition-colors"
                  >
                    {tag.name}
                  </Link>
                ))}
              </>
            )}
            {prediction.isPublic === false && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-navy-800 text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-full border border-navy-600" title="This forecast is unlisted — only visible via direct link.">
                <EyeOff className="w-3 h-3" />
                Unlisted
              </span>
            )}
            {locale !== 'en' && translatedClaim && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTranslated(!showTranslated); }}
                className={`relative z-[2] flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider border transition-colors ${
                  showTranslated ? 'bg-blue-100 text-cobalt-light border-cobalt/30' : 'bg-navy-800 text-gray-500 border-navy-600'
                }`}
                title={showTranslated ? tt('showOriginal') : tt('translate')}
              >
                <Languages className="w-3 h-3" />
                {showTranslated ? tt('showOriginal') : tt('translate')}
              </button>
            )}
          </div>

          {/* Claim Text */}
          <div className="flex items-start gap-3 mb-4">
            <h2 className="flex-1 text-base sm:text-lg font-semibold text-white group-hover:text-cobalt-light transition-colors line-clamp-3 leading-snug">
              {showTranslated && translatedClaim ? translatedClaim : prediction.claimText}
            </h2>
          </div>

          {/* Personal origin marker (no news anchor, manually created) — a subtle
              icon with a tooltip rather than a "no source" text badge. */}
          {!prediction.newsAnchor && prediction.source === 'manual' && (
            <div className="mb-4">
              <span
                role="img"
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-purple-400 bg-purple-400/10 border border-purple-400/20"
                title={t('personalBadge')}
                aria-label={t('personalBadge')}
                data-testid="personal-origin"
              >
                <PenLine className="w-3.5 h-3.5" />
              </span>
            </div>
          )}

        </div>

        {canApprove && (
          <div className="relative z-[2] flex-shrink-0 self-start mt-1 flex gap-2">
            <button
              onClick={handleApprove}
              disabled={isApproving}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors"
              title="Approve forecast"
              aria-label="Approve forecast"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('approve')}
            </button>
            <button
              onClick={handleReject}
              disabled={isApproving}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 border border-red-800/50 hover:bg-red-900/20 disabled:opacity-50 rounded-lg transition-colors"
              title="Reject forecast"
              aria-label="Reject forecast"
            >
              <XCircle className="w-3.5 h-3.5" />
              {t('reject')}
            </button>
          </div>
        )}

        <div className="flex-shrink-0 self-center">
          <div
            className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center group-hover:bg-cobalt/10 transition-colors"
            title={t('openForecastTooltip')}
          >
            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500" />
          </div>
        </div>
      </div>

      {/* Footer sits outside the flex row so its rule spans the whole card
          rather than stopping short of the chevron column. */}
      <div className="flex items-center justify-between pt-4 border-t border-navy-600/50">
        <div className="flex items-center gap-x-4 text-xs text-gray-500">
          {/* Voter count lives in the header pill; only the personal
              "you committed" indicator remains down here. */}
          {prediction.userHasCommitted && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 bg-cobalt/10 text-cobalt-light rounded-full text-[10px] font-medium"
              title={t('committedTooltip')}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>{t('committedLabel')}</span>
            </div>
          )}
        </div>

        {/* Author - Moved to bottom right */}
        <UserLink
          userId={prediction.author.id}
          username={prediction.author.username}
          name={prediction.author.name}
          image={prediction.author.image}
          showAvatar={true}
          avatarSize={20}
          className="relative z-[2] last:border-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-400 hover:text-text-secondary truncate max-w-[100px]">
              {prediction.author.name || t('anonymous')}
            </span>
          </div>
        </UserLink>
      </div>
    </div>
  )
}
