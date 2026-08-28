'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { createClientLogger } from '@/lib/client-logger'
import {
  Calendar,
  Loader2,
  AlertCircle,
  TrendingUp,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Edit2,
  EyeOff,
  Languages,
  Info,
  Share2,
  PenLine,
  Gavel,
  FileQuestion,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useTranslations, useLocale } from 'next-intl'
import { ModeratorResolutionSection } from './ModeratorResolutionSection'
import CommentThread, { type Comment } from '@/components/comments/CommentThread'
import ConfidenceSlider from '@/components/forecasts/ConfidenceSlider'
import Speedometer from '@/components/forecasts/Speedometer'
import ContextTimeline, { settlingSourceNames, type AiEstimate, type Snapshot as ContextSnapshot } from '@/components/forecasts/ContextTimeline'
import { RoleBadge } from '@/components/RoleBadge'
import { UserLink } from '@/components/UserLink'
import { ForecastInfoPanel } from './_forecast/ForecastInfoPanel'
import { ResolutionInfo } from './_forecast/ResolutionInfo'
import { BotApprovalSection } from './_forecast/BotApprovalSection'
import { SimilarForecasts } from './_forecast/SimilarForecasts'
import { CommitmentsHistory } from './_forecast/CommitmentsHistory'
import { ContributingSources } from '@/components/forecasts/ContributingSources'
import type { ContributingSource } from '@/lib/services/forecast-sources'
import { ExternalMarketLinkAdmin } from './_forecast/ExternalMarketLinkAdmin'
import { SettledLatchAdmin } from './_forecast/SettledLatchAdmin'
import { EvidencePoolAdmin } from './_forecast/EvidencePoolAdmin'
import { communityProbability } from '@/lib/forecast-math'
import { marketDisplayProbability, marketLineName, trackedOutcomeLabel } from '@/lib/market-display'
import { formatDisplayDate } from '@/lib/utils/date'
import type { Prediction } from './_forecast/types'

const log = createClientLogger('ForecastDetail')

// recharts is a heavy dependency used only here, so it's loaded on demand
// instead of shipping in the forecast-detail page's initial JS bundle.
const ProbabilityChart = dynamic(() => import('@/components/forecasts/ProbabilityChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
    </div>
  ),
})

export default function ForecastDetailClient({
  initialData,
  isLocalized,
  initialComments,
  initialContextSnapshots,
  initialProbabilityHistory,
  initialContributingSources,
  lastUpdatedISO = null,
  aiPanelSeries = [],
  showAiPanel = false,
  usableEvidenceCount = null,
}: {
  initialData?: Prediction
  isLocalized?: boolean
  initialComments?: Comment[]
  initialContextSnapshots?: ContextSnapshot[]
  /** Chart series incl. kind='clock' glide requotes (the event timeline above excludes them). */
  initialProbabilityHistory?: { id: string; createdAt: string; externalProbability: number | null; kind: string }[]
  initialContributingSources?: ContributingSource[]
  /** Latest probability-update timestamp (server-computed, daatan#1295) — drives the
   *  visible question/answer copy's "as of" date and the FAQPage dateModified. */
  lastUpdatedISO?: string | null
  /** Per-member AI-panel series; only populated (and only rendered) when the viewer opted in. */
  aiPanelSeries?: {
    model: string
    mode: string
    label: string
    color: string
    isControl: boolean
    points: { createdAt: string; probability: number }[]
  }[]
  showAiPanel?: boolean
  /** Pool rows the aggregate could use right now (daatan#1475). Zero means a published
   *  number has no inspectable evidence behind it; null means the caller didn't compute
   *  it, in which case the page says nothing — silence is the fail-open direction here. */
  usableEvidenceCount?: number | null
}) {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  // router.back() is a no-op (or leaves the site) when the forecast was opened via a
  // direct link — there's no in-app history to pop. Next's App Router stores a
  // per-entry `idx` in history.state; `idx === 0` means this is the first entry, so
  // fall back to the feed instead of a dead "Back" button.
  const handleBack = () => {
    if (typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0) {
      router.back()
    } else {
      router.push('/')
    }
  }
  const { data: session } = useSession()
  const t = useTranslations('forecast')
  const tt = useTranslations('translate')
  const locale = useLocale()
  const [prediction, setPrediction] = useState<Prediction | null>(initialData || null)
  const [isLoading, setIsLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const [isApproving, setIsApproving] = useState(false)
  const [showRules, setShowRules] = useState(false)

  // Confidence state (0 to 100 for display; 50 = neutral for BINARY)
  const [userConfidence, setUserConfidence] = useState<number>(50)
  const [initialUserConfidence, setInitialUserConfidence] = useState<number | null>(null)
  const [mcConfidence, setMcConfidence] = useState<number>(70)
  const [aiEstimate, setAiEstimate] = useState<AiEstimate | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Translation state — pre-populate from initialData when the server already localized it
  const [translatedFields, setTranslatedFields] = useState<Record<string, string> | null>(
    isLocalized && initialData
      ? { claimText: initialData.claimText, detailsText: initialData.detailsText ?? '', resolutionRules: initialData.resolutionRules ?? '' }
      : null,
  )
  const [isTranslating, setIsTranslating] = useState(false)
  const [showTranslated, setShowTranslated] = useState(locale !== 'en')

  const canEdit = session?.user?.id === prediction?.author.id || session?.user?.role === 'ADMIN'
  const canApprove = (session?.user?.role === 'ADMIN' || session?.user?.role === 'APPROVER') && prediction?.status === 'PENDING_APPROVAL'

  useEffect(() => {
    if (prediction?.userCommitment) {
      // cuCommitted stores -100..100 for BINARY in DB; convert to 0..100 for display
      const val = prediction.userCommitment.cuCommitted ?? (prediction.userCommitment.binaryChoice ? 70 : -70)
      if (prediction.userCommitment.optionId) {
        setMcConfidence(Math.max(1, Math.abs(val)))
      } else {
        const displayVal = Math.round((val + 100) / 2)
        setUserConfidence(displayVal)
        setInitialUserConfidence(displayVal)
      }
      setSelectedOptionId(prediction.userCommitment.optionId || null)
    }
  }, [prediction?.userCommitment])

  useEffect(() => {
    async function fetchPrediction() {
      try {
        const response = await fetch(`/api/forecasts/${id}`)
        if (!response.ok) {
          if (response.status === 404) throw new Error(t('predictionNotFound'))
          throw new Error(t('failedToLoad'))
        }
        const data = await response.json()
        setPrediction(data)
      } catch (err) {
        // A failed refetch must not replace SSR-seeded content with the error screen:
        // Googlebot's renderer blocks /api/* per robots.txt, and the resulting error
        // page is what got these URLs classified Soft 404 (daatan#1497).
        if (!initialData) {
          setError(err instanceof Error ? err.message : t('somethingWentWrong'))
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchPrediction()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Automatic translation effect
  useEffect(() => {
    if (!prediction || locale === 'en' || translatedFields) return

    async function triggerTranslation() {
      setIsTranslating(true)
      try {
        const response = await fetch(`/api/forecasts/${prediction?.id}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: locale }),
        })
        if (response.ok) {
          const data = await response.json()
          setTranslatedFields(data)
        }
      } catch (err) {
        log.error({ err }, 'Failed to translate prediction')
      } finally {
        setIsTranslating(false)
      }
    }

    triggerTranslation()
  }, [prediction, locale, translatedFields])

  const handleCommitError = async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      signIn()
      return
    }
    if (response.status === 404 && data.error === 'User not found') {
      toast.error(t('sessionExpired'))
      return
    }
    toast.error(data.error || t('commitFailed'))
  }

  const handleCommitConfidence = async () => {
    if (userConfidence === 50 || !prediction) return

    setIsSubmitting(true)
    try {
      // Convert display 0..100 back to DB -100..100 for BINARY before sending
      const dbConfidence = (userConfidence - 50) * 2
      const body: Record<string, unknown> = { confidence: dbConfidence }
      if (prediction.outcomeType === 'MULTIPLE_CHOICE' && selectedOptionId) {
        body.optionId = selectedOptionId
        body.confidence = Math.abs(userConfidence)
      }

      const response = await fetch(`/api/forecasts/${prediction.id}/commit`, {
        method: prediction.userCommitment ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) { await handleCommitError(response); return }

      toast.success(t('forecastRecorded'))
      const updated = await fetch(`/api/forecasts/${id}`).then(r => r.json())
      setPrediction(updated)
      router.refresh()
    } catch {
      toast.error(t('commitFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // UTC-stable so the resolved-on date renders in the SSR HTML (crawlable) with
  // no hydration mismatch — see formatDisplayDate.
  const formatDate = (date: string | Date) => formatDisplayDate(date)

  const handleApproveAction = async (status: 'ACTIVE' | 'VOID') => {
    if (!prediction) return
    setIsApproving(true)
    try {
      const response = await fetch(`/api/admin/forecasts/${prediction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (response.ok) {
        toast.success(status === 'ACTIVE' ? t('approvedSuccess') : t('rejectedSuccess'))
        const updated = await fetch(`/api/forecasts/${id}`).then(r => r.json())
        setPrediction(updated)
        router.refresh()
      } else {
        toast.error(t('operationFailed'))
      }
    } catch (error) {
      log.error({ err: error }, 'Approval error')
      toast.error(t('errorOccurred'))
    } finally {
      setIsApproving(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'bg-navy-700 text-text-secondary'
      case 'ACTIVE': return 'bg-green-100 text-teal'
      case 'PENDING': return 'bg-yellow-100 text-yellow-700'
      case 'PENDING_APPROVAL': return 'bg-amber-100 text-amber-400'
      case 'RESOLVED_CORRECT': return 'bg-blue-100 text-cobalt-light'
      case 'RESOLVED_WRONG': return 'bg-red-100 text-red-400'
      case 'UNRESOLVABLE':
      case 'VOID': return 'bg-orange-100 text-orange-700'
      default: return 'bg-navy-700 text-text-secondary'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  if (error || !prediction) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">
            {error || t('predictionNotFound')}
          </h2>
          <button
            onClick={handleBack}
            className="text-blue-600 hover:underline"
          >
            {t('backToFeed')}
          </button>
        </div>
      </div>
    )
  }

  // Mirrors getCommitmentLockReason server-side (client clock is fine — the
  // server re-validates and returns 409 with the human-readable reason).
  // Note: an Oracle settlement pin (prediction.settled) is notification-only —
  // it does not lock commitments, only the deadline arms below do.
  const DEADLINE_AGREEMENT_TOLERANCE_MS = 72 * 3600_000
  const nowMs = Date.now()
  const claimDeadlineMs = prediction.claimDeadline ? new Date(prediction.claimDeadline).getTime() : null
  const resolveByMs = new Date(prediction.resolveByDatetime).getTime()
  const impossibilityPinned =
    claimDeadlineMs !== null &&
    claimDeadlineMs <= nowMs &&
    Math.abs(claimDeadlineMs - resolveByMs) <= DEADLINE_AGREEMENT_TOLERANCE_MS
  const commitmentsLocked = resolveByMs <= nowMs || impossibilityPinned

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Back Link */}
      <button
        onClick={handleBack}
        className="inline-flex items-center gap-1 text-gray-500 hover:text-text-secondary mb-4 xl:mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('backToFeed')}
      </button>

      <div className="xl:grid xl:grid-cols-[1fr_420px] xl:gap-8 xl:items-start">
        {/* Left column */}
        <div className="min-w-0">

      {/* Header */}
      <div className="mb-4 xl:mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {prediction.status !== 'ACTIVE' && (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(prediction.status)}`}>
                {prediction.status.replace('_', ' ')}
              </span>
            )}

            {/* Deadline - Moved to top */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-navy-700 text-gray-400 text-sm font-medium">
              <Calendar className="w-4 h-4" />
              <span>{formatDisplayDate(prediction.resolveByDatetime)}</span>
            </div>

            {/* Confidence/Probability - Moved to top */}
            {prediction.status === 'ACTIVE' && prediction.outcomeType === 'BINARY' && (() => {
              const prob = communityProbability(prediction.commitments) ?? 50
              return (
                <div
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-navy-700 text-teal text-sm font-medium border border-teal/20"
                  title={t('communityProbabilityTooltip')}
                >
                  <TrendingUp className="w-4 h-4" />
                  <span>{t('legendCommunity')} {prob}%</span>
                </div>
              )
            })()}

            {prediction.isPublic === false && (
              <span className="flex items-center gap-1 px-3 py-1 bg-navy-700 text-gray-400 text-sm font-medium rounded-full">
                <EyeOff className="w-4 h-4" />
                {t('unlistedBadge')}
              </span>
            )}
            {!prediction.newsAnchor && prediction.source === 'manual' && (
              <span
                role="img"
                className="inline-flex items-center justify-center w-7 h-7 text-purple-400 bg-purple-400/10 rounded-full border border-purple-400/20"
                title={t('personalBadge')}
                aria-label={t('personalBadge')}
                data-testid="personal-origin"
              >
                <PenLine className="w-4 h-4" />
              </span>
            )}
            {locale !== 'en' && (
              <button
                onClick={() => setShowTranslated(!showTranslated)}
                disabled={isTranslating}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  showTranslated 
                    ? 'bg-blue-100 text-cobalt-light hover:bg-blue-200' 
                    : 'bg-navy-700 text-gray-400 hover:bg-navy-600'
                }`}
              >
                {isTranslating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Languages className="w-3.5 h-3.5" />
                )}
                {showTranslated ? tt('showOriginal') : tt('translate')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                const url = window.location.href
                if (navigator.share) {
                  await navigator.share({ title: prediction.claimText, url }).catch(() => {})
                } else {
                  await navigator.clipboard.writeText(url)
                  toast.success('Link copied!')
                }
              }}
              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-cobalt/10 rounded-lg transition-colors"
              title="Share forecast"
              aria-label="Share forecast"
            >
              <Share2 className="w-5 h-5" />
            </button>
            {canEdit && (
              <Link
                href={`/forecasts/${prediction.slug || prediction.id}/edit`}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-cobalt/10 rounded-lg transition-colors"
                title={t('editForecastTitle')}
                aria-label={t('editForecastTitle')}
              >
                <Edit2 className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight mb-3 xl:mb-4 break-words">
          {showTranslated && translatedFields?.claimText ? translatedFields.claimText : prediction.claimText}
        </h1>

        <div className="xl:hidden">
          <ForecastInfoPanel prediction={prediction} variant="mobile" />
        </div>

        {(showTranslated && translatedFields) && (
          <div className="flex items-start gap-2 p-3 mb-6 bg-cobalt/10/50 border border-cobalt/20 rounded-lg text-xs text-cobalt-light italic">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{tt('disclaimer')}</p>
          </div>
        )}

      </div>

      {/* Context — the forecast's own description plus the AI-analyzed situation
          summary, unified into one section (replaces the old separate top
          paragraph + collapsible "Situation" panel). */}
      <ContextTimeline
        predictionId={prediction.id}
        initialContext={showTranslated && translatedFields?.detailsText ? translatedFields.detailsText : prediction.detailsText}
        initialContextUpdatedAt={prediction.contextUpdatedAt}
        initialSnapshots={initialContextSnapshots}
        canAnalyze={!!session?.user && prediction.status === 'ACTIVE'}
        newsAnchor={prediction.newsAnchor}
        onAiEstimate={setAiEstimate}
      />

      {/* Resolution Rules */}
      <div className="mb-5 xl:mb-8">
        <button
          type="button"
          onClick={() => setShowRules(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-text-secondary transition-colors"
        >
          {showRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {t('resolutionRulesTitle')}
        </button>
        {/* Always in the DOM (crawlable); collapsed via CSS rather than removed,
            so the resolution rules are part of the SSR HTML for SEO. */}
        <div className={`mt-2 p-3 bg-navy-800 border border-navy-600 rounded-lg text-sm text-text-secondary whitespace-pre-wrap ${showRules ? '' : 'hidden'}`}>
          {prediction.resolutionRules ?? t('noResolutionRules')}
        </div>
      </div>

      {/* Probability Display (Interactive Gauge) */}
      <div className="mb-12">
        {prediction.outcomeType === 'BINARY' && (() => {
          const marketProb = communityProbability(prediction.commitments) ?? 50
          // The AI needle/band read the prediction's funnel-maintained cache
          // (confidence/aiCiLow/aiCiHigh — includes the daily glide requote);
          // `aiEstimate` overrides only after an in-page analyze run produces a
          // fresher value. Abstention: latest run had no bearing evidence —
          // hide the needle and show "Insufficient evidence".
          const aiAbstained = aiEstimate ? !!aiEstimate.abstained : !!initialContextSnapshots?.[0]?.insufficientData
          const aiVal = aiAbstained ? null : (aiEstimate?.probability ?? prediction.confidence ?? null)
          // Settlement pin (#1250): the Oracle read the question as already
          // decided and REPLACED the pooled estimate with a pinned constant.
          // Same freshness rule as aiAbstained — an in-page analyze run's
          // aiEstimate overrides the server-prefetched latest snapshot.
          const latestOracle = initialContextSnapshots?.[0]?.oracleSnapshot ?? null
          const aiSettled = !aiAbstained && (aiEstimate ? !!aiEstimate.settled : !!latestOracle?.settled)
          const settlerNames = aiSettled ? settlingSourceNames(latestOracle) : []

          return (
            <div className="flex flex-col items-center">
              <div className="w-full max-w-lg relative rounded-3xl border border-navy-600 bg-navy-700 p-5 sm:p-10 xl:p-12 flex flex-col items-center justify-center shadow-2xl overflow-hidden">
                {/* Background glow */}
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

                <Speedometer
                  percentage={marketProb}
                  userPercentage={userConfidence}
                  centerLabel={t('legendYou')}
                  aiPercentage={aiAbstained ? undefined : (aiEstimate?.probability ?? prediction.confidence ?? undefined)}
                  aiCiLow={aiAbstained ? undefined : (aiEstimate?.ciLow ?? prediction.aiCiLow ?? undefined)}
                  aiCiHigh={aiAbstained ? undefined : (aiEstimate?.ciHigh ?? prediction.aiCiHigh ?? undefined)}
                  size="xl"
                  onUserPercentageChange={prediction.status === 'ACTIVE' && !commitmentsLocked
                    ? (pct) => setUserConfidence(Math.round(pct))
                    : undefined}
                />

                {/* Legend */}
                <div className="flex justify-center gap-6 mt-6 xl:mt-10 text-[10px] font-bold uppercase tracking-widest border-t border-navy-600 pt-4 xl:pt-8 w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-1 bg-[#A0AEC0] rounded-full" />
                    <span className="text-gray-400">{t('legendCommunity')} {marketProb}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 bg-[#3B82F6] rounded-full" />
                    <span className="text-blue-400">{t('legendYou')} {userConfidence}%</span>
                  </div>
                  {aiAbstained ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-1 bg-[#FBBF24]/40 rounded-full" />
                      <span className="text-amber-400/70">{t('legendAI')} · {t('aiInsufficientEvidence')}</span>
                    </div>
                  ) : aiVal != null && (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-1 bg-[#FBBF24] rounded-full" />
                      <span className="text-amber-400">{t('legendAI')} {aiVal}%</span>
                    </div>
                  )}
                </div>

                {/* Settlement-pin indicator (#1250): the AI number above is a pin,
                    not a pooled average — say so, and name the settling sources. */}
                {aiSettled && (
                  <div
                    className="mt-4 w-full flex items-start gap-2 text-left text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
                    data-testid="settled-pin-notice"
                  >
                    <Gavel className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <p>
                      {t('settledPinNotice')}
                      {settlerNames.length > 0 && (
                        <span className="block mt-0.5 text-amber-200/80">
                          {t('settledPinSources', { names: settlerNames.join(', ') })}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {/* Unevidenced number (daatan#1475): a published confidence whose pool
                    holds nothing the aggregate can read — every extraction failed, was
                    excluded, or came back incomplete. Measured at filing: 9 ACTIVE
                    forecasts, 2 of them in the extreme band. Say so rather than hide the
                    number: suppressing it would render identically to an abstention,
                    which is a different state (the write layer distinguishes "abstained"
                    from "never had evidence" since daatan#1473, and collapsing them here
                    would undo that at the last mile). Not shown when the run abstained —
                    that case already hides the needle above. */}
                {!aiAbstained && aiVal != null && usableEvidenceCount === 0 && (
                  <div
                    className="mt-4 w-full flex items-start gap-2 text-left text-xs text-gray-400 bg-navy-800/60 border border-navy-600 rounded-lg px-3 py-2"
                    data-testid="unevidenced-notice"
                  >
                    <FileQuestion className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <p>{t('aiUnevidencedNotice')}</p>
                  </div>
                )}

                {/* Temporal-clock annotation: only for diffuse-deadline claims the
                    daily glide actually prices (retro docs/TEMPORAL_MODEL_PLAN.md). */}
                {!aiAbstained && prediction.claimArchetype === 'DIFFUSE' && prediction.claimDeadline && !commitmentsLocked && (() => {
                  const daysLeft = Math.ceil((new Date(prediction.claimDeadline).getTime() - Date.now()) / 86_400_000)
                  return daysLeft > 0 ? (
                    <p className="mt-3 text-center text-[11px] text-gray-500">
                      {t('temporalClockAnnotation', { days: daysLeft })}
                    </p>
                  ) : null
                })()}

                {/* Confidence Slider Integration (Desktop & Mobile) */}
                <div className="w-full mt-10">
                  {session ? (
                    <ConfidenceSlider
                      value={userConfidence}
                      onChange={setUserConfidence}
                      onCommit={handleCommitConfidence}
                      isSubmitting={isSubmitting}
                      disabled={prediction.status !== 'ACTIVE' || commitmentsLocked}
                      canCommit={userConfidence !== initialUserConfidence}
                      isCommitted={!!prediction.userCommitment}
                    />
                  ) : (
                    <button
                      onClick={() => signIn()}
                      className="w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20 active:scale-[0.98] border border-blue-400/30 transition-all duration-200"
                    >
                      {t('signInToVote')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {prediction.outcomeType === 'MULTIPLE_CHOICE' && prediction.options.length > 0 && (() => {
          const totalCommits = prediction.commitments.length
          const optionsWithStats = prediction.options.map(opt => ({
            ...opt,
            commitCount: prediction.commitments.filter(c => c.option?.id === opt.id).length,
            pct: totalCommits > 0 ? Math.round((prediction.commitments.filter(c => c.option?.id === opt.id).length / totalCommits) * 100) : 0
          })).sort((a, b) => b.commitCount - a.commitCount)

          const userOptionId = prediction.userCommitment?.optionId

          const handleCommitMultipleChoice = async () => {
            if (!selectedOptionId || !prediction) return

            setIsSubmitting(true)
            try {
              const response = await fetch(`/api/forecasts/${prediction.id}/commit`, {
                method: prediction.userCommitment ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  confidence: Math.max(1, mcConfidence),
                  optionId: selectedOptionId,
                }),
              })

              if (!response.ok) { await handleCommitError(response); return }

              toast.success(t('forecastRecorded'))
              const updated = await fetch(`/api/forecasts/${id}`).then(r => r.json())
              setPrediction(updated)
              router.refresh()
            } catch {
              toast.error(t('commitFailed'))
            } finally {
              setIsSubmitting(false)
            }
          }

          return (
            <div className="w-full max-w-2xl mx-auto">
              <div className="bg-navy-700 border border-navy-600 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
                {/* Background glow */}
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
                
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-8 text-center">{t('marketDistribution')}</h3>
                
                <div className="space-y-4 mb-10">
                  {optionsWithStats.map((option) => {
                    const isSelected = selectedOptionId === option.id
                    const isActive = prediction.status === 'ACTIVE' && !commitmentsLocked
                    return (
                      <div key={option.id} className={`relative rounded-2xl border transition-all duration-200 ${
                        isSelected
                          ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                          : 'bg-navy-800/50 border-navy-600'
                      }`}>
                        <button
                          onClick={() => isActive && setSelectedOptionId(option.id)}
                          disabled={!isActive || isSubmitting}
                          className="w-full group flex flex-col p-4"
                        >
                          <div className="flex justify-between items-center mb-2 relative z-10">
                            <div className="flex items-center gap-3">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                isSelected ? 'border-blue-400 bg-blue-500' : 'border-navy-500'
                              }`}>
                                {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                              </div>
                              <span className={`font-semibold transition-colors ${isSelected ? 'text-blue-400' : 'text-white group-hover:text-blue-300'}`}>
                                {option.text}
                              </span>
                            </div>
                            <span className="font-mono text-sm font-bold text-gray-400">{option.pct}%</span>
                          </div>

                          {/* Progress Bar */}
                          <div className="w-full h-2 bg-navy-900 rounded-full overflow-hidden relative z-10">
                            <div
                              className={`h-full transition-all duration-1000 ease-out rounded-full ${
                                isSelected ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-navy-600'
                              }`}
                              style={{ width: `${option.pct}%` }}
                            />
                          </div>
                        </button>

                        {/* Inline confidence slider — only on selected option */}
                        {isSelected && isActive && (
                          <div className="px-4 pb-4 space-y-2">
                            <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-gray-500">
                              <span>{t('low')}</span>
                              <span className="text-blue-400 font-bold">{t('confidencePercent', { value: mcConfidence })}</span>
                              <span className="text-teal">{t('high')}</span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="100"
                              step="1"
                              value={mcConfidence}
                              onChange={(e) => setMcConfidence(parseInt(e.target.value))}
                              disabled={isSubmitting}
                              aria-label="Confidence"
                              className="w-full h-3 bg-navy-900 rounded-lg appearance-none cursor-pointer accent-blue-500 border border-blue-500/30"
                            />
                          </div>
                        )}

                        {/* Your indicator */}
                        {userOptionId === option.id && (
                          <div className="absolute -right-2 -top-2 bg-blue-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg transform rotate-12 uppercase tracking-tighter z-20">
                            {t('yourChoice')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {!session ? (
                  <button
                    onClick={() => signIn()}
                    className="w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20 active:scale-[0.98] border border-blue-400/30 transition-all duration-200"
                  >
                    Sign in to vote
                  </button>
                ) : prediction.status === 'ACTIVE' && prediction.userCommitment && selectedOptionId === userOptionId && mcConfidence === Math.max(1, Math.abs(prediction.userCommitment.cuCommitted ?? 70)) ? (
                  <div className="flex items-center justify-center gap-2 py-4 px-4 bg-teal/10 border border-teal/30 rounded-xl">
                    <span className="text-sm font-bold text-teal uppercase tracking-widest">{t('yourForecastCommitted')}</span>
                  </div>
                ) : (
                  <button
                    onClick={handleCommitMultipleChoice}
                    disabled={!selectedOptionId || prediction.status !== 'ACTIVE' || commitmentsLocked || isSubmitting}
                    className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 ${
                      !selectedOptionId || prediction.status !== 'ACTIVE' || commitmentsLocked || isSubmitting
                        ? 'bg-navy-800 text-gray-400 cursor-not-allowed border border-navy-600'
                        : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20 active:scale-[0.98] border border-blue-400/30'
                    }`}
                  >
                    {isSubmitting ? t('submitting') : t('commitForecastButton')}
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* Related forecasts: inline on mobile/tablet (after the gauge, so users
          commit their own confidence before seeing others' forecasts), in the
          right column on desktop */}
      <div className="xl:hidden">
        <SimilarForecasts predictionId={prediction.id} />
      </div>

      {/* Resolution Info (if resolved) */}
      <ResolutionInfo prediction={prediction} formatDate={formatDate} />

      {/* Approval Section for PENDING_APPROVAL forecasts */}
      {canApprove && (
        <BotApprovalSection
          prediction={prediction}
          isApproving={isApproving}
          onApprove={handleApproveAction}
        />
      )}

      {/* Moderator Resolution Section */}
      <ModeratorResolutionSection
        predictionId={prediction.id}
        predictionStatus={prediction.status}
        outcomeType={prediction.outcomeType}
        options={prediction.options}
        settled={prediction.settled}
        confidence={prediction.confidence}
      />

      {/* Admin-only false-settlement override (renders nothing unless settled) */}
      <SettledLatchAdmin
        prediction={prediction}
        onCleared={() => setPrediction(p => (p ? { ...p, settled: false } : p))}
      />

      {/* Admin-only external-market link control (renders nothing for non-admins) */}
      <ExternalMarketLinkAdmin prediction={prediction} />

      {/* Admin-only evidence pool viewer + per-article exclusion (renders nothing for non-admins) */}
      <EvidencePoolAdmin predictionId={prediction.id} />

      {/* Probability chart — shown when ≥3 commitments OR a linked market has history.
          Market prices are polarity-adjusted here (inverted links plot 100 − price)
          and the legend says so, so the line always matches the claim's direction. */}
      <ProbabilityChart
        commitments={prediction.commitments}
        snapshots={initialProbabilityHistory ?? initialContextSnapshots ?? []}
        outcomeType={prediction.outcomeType}
        options={prediction.options}
        marketSnapshots={(prediction.externalMarket?.snapshots ?? []).map(s => ({
          ...s,
          probability: marketDisplayProbability(s.probability, prediction.externalMarketInverted ?? false),
        }))}
        marketLabel={marketLineName(
          prediction.externalMarket?.provider === 'KALSHI' ? 'Kalshi' : 'Polymarket',
          prediction.externalMarketInverted ?? false,
          trackedOutcomeLabel(prediction.externalMarket?.outcomes),
        )}
        panelSeries={aiPanelSeries}
        showAiPanel={showAiPanel}
      />

      {/* Commitments List */}
      <CommitmentsHistory
        prediction={prediction}
        currentUserId={session?.user?.id}
        authorId={prediction.author.id}
        onRemove={prediction.status === 'ACTIVE' && !commitmentsLocked
          ? () => fetch(`/api/forecasts/${prediction.id}`).then(r => r.json()).then(setPrediction)
          : undefined}
      />

      {/* Publications that fed the Oracle — a roster of "AI forecasters",
          shown like the human commitments above but in its own section. */}
      <ContributingSources sources={initialContributingSources ?? []} />

      {/* Author credit. If the author also voted, they're already tagged
          "author" in the Forecasts History list above, so skip this. */}
      {!prediction.commitments.some(c => c.user.id === prediction.author.id) && (
        <div className="mt-8 flex items-center gap-2.5 text-sm text-gray-400">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 shrink-0">
            {t('author')}
          </span>
          <span className="text-gray-600">·</span>
          <UserLink
            userId={prediction.author.id}
            username={prediction.author.username}
            name={prediction.author.name}
            image={prediction.author.image}
            showAvatar={true}
            avatarSize={24}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium text-white truncate">{prediction.author.name}</span>
              {prediction.author.role && (
                <RoleBadge role={prediction.author.role} size="sm" />
              )}
            </span>
          </UserLink>
          <span className="text-gray-600 shrink-0">·</span>
          <span className="text-xs text-gray-500 shrink-0">{t('reputationShort')} {prediction.author.rs.toFixed(0)}</span>
        </div>
      )}

      {/* Comments Section — inline on mobile/tablet; in the right column on desktop */}
      <div className="xl:hidden border-t border-navy-600 mt-12 pt-8">
        <CommentThread predictionId={prediction.id} initialComments={initialComments} />
      </div>

      {/* Server-rendered summary line, placed last so it reads as a quiet
          metadata footer rather than competing with the claim for attention.
          Guarantees every forecast page — even a one-sentence claim with no
          description — carries unique, substantive prose in the initial
          HTML, which is what stops Google's thin-content "Soft 404" verdict.
          English only: it's the canonical (indexed) locale; localized routes
          are hreflang alternates. */}
      {locale === 'en' && (() => {
        const created = formatDisplayDate(prediction.createdAt)
        const resolves = formatDisplayDate(prediction.resolveByDatetime)
        const forecasters = prediction.commitments.length
        const consensus = prediction.outcomeType === 'BINARY' ? communityProbability(prediction.commitments) : null
        const aiSnap = initialContextSnapshots?.[0]
        // prediction.confidence is the funnel-maintained cache (incl. glide) — authoritative over the last evidence snapshot.
        const ai = aiSnap?.insufficientData ? null : (prediction.confidence ?? aiSnap?.externalProbability ?? null)
        const status =
          prediction.resolvedAt && prediction.resolutionOutcome
            ? `resolved ${prediction.resolutionOutcome}`
            : prediction.status === 'ACTIVE'
              ? 'open for forecasts'
              : prediction.status.replace(/_/g, ' ').toLowerCase()
        const parts = [
          `Forecast by ${prediction.author.name || prediction.author.username}`,
          `opened ${created}`,
          `resolves ${resolves}`,
          `${forecasters} ${forecasters === 1 ? 'forecaster' : 'forecasters'}`,
        ]
        if (consensus != null) parts.push(`community consensus ${consensus}%`)
        if (ai != null) parts.push(`AI estimate ${ai}%`)
        parts.push(status)
        return (
          <p className="text-xs text-gray-500 mt-8 pt-6 border-t border-navy-600 leading-relaxed">
            {parts.join(' · ')}.
          </p>
        )
      })()}

        </div>{/* end left column */}

        {/* Right column (desktop). Not sticky: it holds related forecasts and
            the full discussion, which can be taller than the viewport. */}
        <div className="hidden xl:block space-y-4">
          <ForecastInfoPanel prediction={prediction} />
          <SimilarForecasts predictionId={prediction.id} />
          <CommentThread predictionId={prediction.id} initialComments={initialComments} />
        </div>
      </div>
    </div>
  )
}
