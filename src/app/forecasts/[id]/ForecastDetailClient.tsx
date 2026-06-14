'use client'

import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useTranslations, useLocale } from 'next-intl'
import { ModeratorResolutionSection } from './ModeratorResolutionSection'
import CommentThread, { type Comment } from '@/components/comments/CommentThread'
import ConfidenceSlider from '@/components/forecasts/ConfidenceSlider'
import Speedometer from '@/components/forecasts/Speedometer'
import ContextTimeline, { type AiEstimate, type Snapshot as ContextSnapshot } from '@/components/forecasts/ContextTimeline'
import { RoleBadge } from '@/components/RoleBadge'
import { UserLink } from '@/components/UserLink'
import { ForecastInfoPanel } from './_forecast/ForecastInfoPanel'
import { ResolutionInfo } from './_forecast/ResolutionInfo'
import { BotApprovalSection } from './_forecast/BotApprovalSection'
import { SimilarForecasts } from './_forecast/SimilarForecasts'
import { CommitmentsHistory } from './_forecast/CommitmentsHistory'
import { ExternalMarketLinkAdmin } from './_forecast/ExternalMarketLinkAdmin'
import ProbabilityChart from '@/components/forecasts/ProbabilityChart'
import type { Prediction } from './_forecast/types'

const log = createClientLogger('ForecastDetail')

export default function ForecastDetailClient({
  initialData,
  isLocalized,
  initialComments,
  initialContextSnapshots,
}: {
  initialData?: Prediction
  isLocalized?: boolean
  initialComments?: Comment[]
  initialContextSnapshots?: ContextSnapshot[]
}) {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations('forecast')
  const tt = useTranslations('translate')
  const locale = useLocale()
  const [prediction, setPrediction] = useState<Prediction | null>(initialData || null)
  const [isLoading, setIsLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const [isApproving, setIsApproving] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
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
    setIsMounted(true)
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
        setError(err instanceof Error ? err.message : t('somethingWentWrong'))
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

  const formatDate = (date: string | Date) => {
    if (!isMounted) return ''
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

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
            onClick={() => router.back()}
            className="text-blue-600 hover:underline"
          >
            {t('backToFeed')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Back Link */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-gray-500 hover:text-text-secondary mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('backToFeed')}
      </button>

      <div className="xl:grid xl:grid-cols-[1fr_420px] xl:gap-8 xl:items-start">
        {/* Left column */}
        <div className="min-w-0">

      {/* Header */}
      <div className="mb-6">
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
              <span suppressHydrationWarning>
                {isMounted && new Date(prediction.resolveByDatetime).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            </div>

            {/* Confidence/Probability - Moved to top */}
            {prediction.status === 'ACTIVE' && prediction.outcomeType === 'BINARY' && (() => {
              const yesTokens = prediction.commitments.filter(c => c.binaryChoice === true).reduce((sum, c) => sum + c.cuCommitted, 0)
              const noTokens = prediction.commitments.filter(c => c.binaryChoice === false).reduce((sum, c) => sum + Math.abs(c.cuCommitted), 0)
              const prob = (yesTokens + noTokens) > 0 ? Math.round((yesTokens / (yesTokens + noTokens)) * 100) : 50
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
              <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-purple-400 bg-purple-400/10 rounded-full border border-purple-400/20">
                {t('personalBadge')}
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
            >
              <Share2 className="w-5 h-5" />
            </button>
            {canEdit && (
              <Link
                href={`/forecasts/${prediction.slug || prediction.id}/edit`}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-cobalt/10 rounded-lg transition-colors"
                title={t('editForecastTitle')}
              >
                <Edit2 className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight mb-4 break-words">
          {showTranslated && translatedFields?.claimText ? translatedFields.claimText : prediction.claimText}
        </h1>

        <div className="xl:hidden">
          <ForecastInfoPanel prediction={prediction} variant="mobile" isMounted={isMounted} />
        </div>

        {(showTranslated && translatedFields) && (
          <div className="flex items-start gap-2 p-3 mb-6 bg-cobalt/10/50 border border-cobalt/20 rounded-lg text-xs text-cobalt-light italic">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{tt('disclaimer')}</p>
          </div>
        )}

        {(showTranslated && translatedFields?.detailsText ? translatedFields.detailsText : prediction.detailsText) && (
          <div className="prose prose-sm max-w-none text-text-secondary mb-8 whitespace-pre-wrap">
            {showTranslated && translatedFields?.detailsText ? translatedFields.detailsText : prediction.detailsText}
          </div>
        )}
      </div>

      {/* Resolution Rules */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => setShowRules(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-text-secondary transition-colors"
        >
          {showRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {t('resolutionRulesTitle')}
        </button>
        {showRules && (
          <div className="mt-2 p-3 bg-navy-800 border border-navy-600 rounded-lg text-sm text-text-secondary whitespace-pre-wrap">
            {prediction.resolutionRules ?? t('noResolutionRules')}
          </div>
        )}
      </div>

      {/* Situation Context / Timeline */}
      <ContextTimeline
        predictionId={prediction.id}
        initialContext={prediction.detailsText}
        initialContextUpdatedAt={prediction.contextUpdatedAt}
        initialSnapshots={initialContextSnapshots}
        canAnalyze={!!session?.user && prediction.status === 'ACTIVE'}
        newsAnchor={prediction.newsAnchor}
        onAiEstimate={setAiEstimate}
      />

      {/* Related forecasts: inline on mobile/tablet, in the right column on desktop */}
      <div className="xl:hidden">
        <SimilarForecasts predictionId={prediction.id} />
      </div>

      {/* Probability Display (Interactive Gauge) */}
      <div className="mb-12">
        {prediction.outcomeType === 'BINARY' && (() => {
          const yesTokens = prediction.commitments.filter(c => c.binaryChoice === true).reduce((sum, c) => sum + c.cuCommitted, 0)
          const noTokens = prediction.commitments.filter(c => c.binaryChoice === false).reduce((sum, c) => sum + Math.abs(c.cuCommitted), 0)
          const marketProb = (yesTokens + noTokens) > 0 ? Math.round((yesTokens / (yesTokens + noTokens)) * 100) : 50
          const aiVal = aiEstimate?.probability ?? prediction.confidence ?? null

          return (
            <div className="flex flex-col items-center">
              <div className="w-full max-w-lg relative rounded-3xl border border-navy-600 bg-navy-700 p-8 sm:p-12 flex flex-col items-center justify-center shadow-2xl overflow-hidden">
                {/* Background glow */}
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

                <Speedometer
                  percentage={marketProb}
                  userPercentage={userConfidence}
                  centerLabel={t('legendYou')}
                  aiPercentage={aiEstimate?.probability ?? prediction.confidence ?? undefined}
                  aiCiLow={aiEstimate?.ciLow ?? prediction.aiCiLow ?? undefined}
                  aiCiHigh={aiEstimate?.ciHigh ?? prediction.aiCiHigh ?? undefined}
                  size="xl"
                  onUserPercentageChange={prediction.status === 'ACTIVE'
                    ? (pct) => setUserConfidence(Math.round(pct))
                    : undefined}
                />

                {/* Legend */}
                <div className="flex justify-center gap-6 mt-10 text-[10px] font-bold uppercase tracking-widest border-t border-navy-600 pt-8 w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-1 bg-[#A0AEC0] rounded-full" />
                    <span className="text-gray-400">{t('legendCommunity')} {marketProb}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 bg-[#3B82F6] rounded-full" />
                    <span className="text-blue-400">{t('legendYou')} {userConfidence}%</span>
                  </div>
                  {aiVal != null && (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-1 bg-[#FBBF24] rounded-full" />
                      <span className="text-amber-400">{t('legendAI')} {aiVal}%</span>
                    </div>
                  )}
                </div>

                {/* Confidence Slider Integration (Desktop & Mobile) */}
                <div className="w-full mt-10">
                  {session ? (
                    <ConfidenceSlider
                      value={userConfidence}
                      onChange={setUserConfidence}
                      onCommit={handleCommitConfidence}
                      isSubmitting={isSubmitting}
                      disabled={prediction.status !== 'ACTIVE'}
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
                    const isActive = prediction.status === 'ACTIVE'
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
                    disabled={!selectedOptionId || prediction.status !== 'ACTIVE' || isSubmitting}
                    className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 ${
                      !selectedOptionId || prediction.status !== 'ACTIVE' || isSubmitting
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
      />

      {/* Admin-only external-market link control (renders nothing for non-admins) */}
      <ExternalMarketLinkAdmin prediction={prediction} />

      {/* Probability chart — shown when ≥3 commitments OR a linked market has history */}
      <ProbabilityChart
        commitments={prediction.commitments}
        snapshots={initialContextSnapshots ?? []}
        outcomeType={prediction.outcomeType}
        options={prediction.options}
        marketSnapshots={prediction.externalMarket?.snapshots ?? []}
      />

      {/* Commitments List */}
      <CommitmentsHistory
        prediction={prediction}
        currentUserId={session?.user?.id}
        authorId={prediction.author.id}
        onRemove={prediction.status === 'ACTIVE'
          ? () => fetch(`/api/forecasts/${prediction.id}`).then(r => r.json()).then(setPrediction)
          : undefined}
      />

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

        </div>{/* end left column */}

        {/* Right column (desktop). Not sticky: it holds related forecasts and
            the full discussion, which can be taller than the viewport. */}
        <div className="hidden xl:block space-y-4">
          <ForecastInfoPanel
            prediction={prediction}
            isMounted={isMounted}
          />
          <SimilarForecasts predictionId={prediction.id} />
          <CommentThread predictionId={prediction.id} initialComments={initialComments} />
        </div>
      </div>
    </div>
  )
}
