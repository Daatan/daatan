'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { analytics } from '@/lib/analytics'
import { localEndOfDay } from '@/lib/utils/date'
import {
  Newspaper,
  FileText,
  Target,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  TrendingUp,
  ExternalLink,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCapabilities } from '@/components/CapabilitiesProvider'
import { StepNewsAnchor } from './steps/StepNewsAnchor'
import { StepPrediction } from './steps/StepPrediction'
import { StepOutcome } from './steps/StepOutcome'
import { StepPublish } from './steps/StepPublish'
import { SubmitProgress, type SubmitPhase } from './SubmitProgress'
import { getEstimate, recordDuration } from '@/lib/forecast-timing'

export type PredictionFormData = {
  // Step 1: News Anchor
  newsAnchorId?: string
  newsAnchorUrl?: string
  newsAnchorTitle?: string

  // Step 2: Prediction
  claimText: string
  detailsText?: string
  tags: string[]

  // Step 3: Outcome
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'NUMERIC_THRESHOLD'
  outcomeOptions?: string[]
  numericThreshold?: {
    metric: string
    threshold: number
    direction: 'above' | 'below' | 'exactly'
  }
  resolveByDatetime: string
  resolutionRules?: string

  // Step 4: Publish
  cuCommitted?: number
  isPublic: boolean

  // Set when the forecast was imported from a Polymarket/Kalshi URL (links the market on create)
  externalMarketId?: string
}

/** A "same question" market surfaced after the claim step (see /api/forecasts/suggest-market). */
type MarketMatch = {
  externalMarketId: string
  provider: 'POLYMARKET' | 'KALSHI'
  providerLabel: string
  question: string
  yesProbability: number
  url: string
  score: number
}

const STEPS = [
  { id: 1, titleKey: 'stepNewsAnchorTitle', icon: Newspaper, descKey: 'stepNewsAnchorDesc' },
  { id: 2, titleKey: 'stepPredictionTitle', icon: FileText, descKey: 'stepPredictionDesc' },
  { id: 3, titleKey: 'stepOutcomeTitle', icon: Target, descKey: 'stepOutcomeDesc' },
  { id: 4, titleKey: 'stepPublishTitle', icon: Rocket, descKey: 'stepPublishDesc' },
] as const

interface ForecastWizardProps {
  isExpressFlow?: boolean
  initialClaim?: string
}

const DRAFT_KEY = 'daatan:forecast-draft'

export const ForecastWizard = ({ isExpressFlow = false, initialClaim = '' }: ForecastWizardProps) => {
  const router = useRouter()
  const t = useTranslations('wizard')
  const { externalMarkets } = useCapabilities()
  const [currentStep, setCurrentStep] = useState(isExpressFlow ? 2 : 1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('creating')
  const [submitMode, setSubmitMode] = useState<'draft' | 'publish'>('publish')
  const [estimates, setEstimates] = useState({ create: 5000, publish: 1500 })
  const [error, setError] = useState<string | null>(null)
  const [marketMatch, setMarketMatch] = useState<MarketMatch | null>(null)
  const [matchDismissed, setMatchDismissed] = useState(false)

  const [formData, setFormData] = useState<PredictionFormData>({
    claimText: initialClaim,
    tags: [],
    outcomeType: 'BINARY',
    resolveByDatetime: '',
    isPublic: true,
  })

  // Restore saved draft from sessionStorage on mount (manual flow only)
  useEffect(() => {
    if (isExpressFlow) return
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY)
      if (!saved) return
      const { formData: savedData, currentStep: savedStep } = JSON.parse(saved)
      setFormData(prev => ({ ...prev, ...savedData }))
      setCurrentStep(savedStep ?? 1)
    } catch {
      // Corrupt or missing — ignore
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist form state to sessionStorage on every change (manual flow only)
  useEffect(() => {
    if (isExpressFlow) return
    if (!formData.claimText && !formData.newsAnchorUrl) return
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ formData, currentStep }))
    } catch {
      // sessionStorage full or unavailable — ignore
    }
  }, [formData, currentStep, isExpressFlow])

  // Load express prediction data from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    if (!isExpressFlow) return

    const stored = localStorage.getItem('expressPredictionData')
    if (!stored) return

    try {
      const data = JSON.parse(stored)
      localStorage.removeItem('expressPredictionData')

      // Convert ISO datetime (e.g. "2026-06-15T12:00:00.000Z") to YYYY-MM-DD
      // because <input type="date"> requires that format
      let resolveDate = data.resolveByDatetime || ''
      if (resolveDate && resolveDate.includes('T')) {
        resolveDate = resolveDate.split('T')[0]
      }

      // Determine outcome type — default to BINARY if not recognized
      const outcomeType = data.outcomeType === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : 'BINARY'
      const outcomeOptions = outcomeType === 'MULTIPLE_CHOICE' && Array.isArray(data.options)
        ? data.options.filter((o: string) => o.trim())
        : undefined

      setFormData({
        claimText: data.claimText || '',
        detailsText: data.detailsText || '',
        tags: data.tags || [],
        outcomeType,
        outcomeOptions,
        resolveByDatetime: resolveDate,
        resolutionRules: data.resolutionRules || '',
        newsAnchorUrl: data.newsAnchor?.url || '',
        newsAnchorTitle: data.newsAnchor?.title || '',
        isPublic: data.isPublic !== false,
      })
    } catch {
      // Invalid JSON — ignore
    }
  }, [isExpressFlow])

  const updateFormData = (updates: Partial<PredictionFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }))
  }

  // After the claim step, look for a "same question" market to offer linking.
  // Non-blocking: we advance immediately and surface the prompt when it returns.
  const checkMarketMatch = async (claimText: string) => {
    try {
      const res = await fetch('/api/forecasts/suggest-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimText }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.match) {
        setMarketMatch(data.match)
        setMatchDismissed(false)
      }
    } catch {
      // best-effort — a missing suggestion never blocks creation
    }
  }

  const handleNext = () => {
    if (
      externalMarkets &&
      currentStep === 2 &&
      !formData.externalMarketId &&
      !matchDismissed &&
      formData.claimText.trim().length >= 10
    ) {
      void checkMarketMatch(formData.claimText)
    }
    if (currentStep < 4) {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    const minStep = isExpressFlow ? 2 : 1
    if (currentStep > minStep) {
      setCurrentStep(prev => prev - 1)
    }
  }

  const handleSubmit = async (asDraft: boolean = false) => {
    // Guard against stale drafts: validate required fields before API call
    if (!asDraft) {
      if (!formData.claimText || formData.claimText.length < 10) {
        setCurrentStep(2)
        setError(t('errClaimMin'))
        return
      }
      if (!formData.resolutionRules || formData.resolutionRules.trim().length < 10) {
        setCurrentStep(3)
        setError(t('errRulesRequired'))
        return
      }
      if (!formData.resolveByDatetime || localEndOfDay(formData.resolveByDatetime) <= new Date()) {
        setCurrentStep(3)
        setError(t('errDateFuture'))
        return
      }
    }

    setSubmitMode(asDraft ? 'draft' : 'publish')
    setSubmitPhase('creating')
    setEstimates({ create: getEstimate('forecast-create'), publish: getEstimate('forecast-publish') })
    setIsSubmitting(true)
    setError(null)

    try {
      // Build outcome payload
      let outcomePayload: Record<string, unknown> = {}
      if (formData.outcomeType === 'BINARY') {
        outcomePayload = { type: 'BINARY' }
      } else if (formData.outcomeType === 'MULTIPLE_CHOICE' && formData.outcomeOptions) {
        outcomePayload = { type: 'MULTIPLE_CHOICE', options: formData.outcomeOptions }
      } else if (formData.outcomeType === 'NUMERIC_THRESHOLD' && formData.numericThreshold) {
        outcomePayload = { type: 'NUMERIC_THRESHOLD', ...formData.numericThreshold }
      }

      // Create prediction
      const createStart = performance.now()
      const response = await fetch('/api/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsAnchorId: formData.newsAnchorId || undefined,
          newsAnchorUrl: formData.newsAnchorUrl || undefined,
          newsAnchorTitle: formData.newsAnchorTitle || undefined,
          claimText: formData.claimText,
          detailsText: formData.detailsText,
          tags: formData.tags,
          outcomeType: formData.outcomeType,
          outcomePayload,
          resolutionRules: formData.resolutionRules,
          resolveByDatetime: localEndOfDay(formData.resolveByDatetime).toISOString(),
          isPublic: formData.isPublic,
          source: (!formData.newsAnchorId && !formData.newsAnchorUrl) ? 'manual' : undefined,
          externalMarketId: formData.externalMarketId || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        // If the server returns field-level validation details, navigate to the right step
        if (data.details?.length) {
          const fieldToStep: Record<string, number> = {
            claimText: 2, detailsText: 2, tags: 2,
            resolutionRules: 3, resolveByDatetime: 3, outcomeType: 3, outcomePayload: 3,
          }
          const firstField = String(data.details[0]?.path?.[0] ?? '')
          const targetStep = fieldToStep[firstField]
          if (targetStep) setCurrentStep(targetStep)
        }
        throw new Error(data.error || t('errCreateFailed'))
      }

      const prediction = await response.json()
      recordDuration('forecast-create', performance.now() - createStart)

      // If not draft, publish immediately
      if (!asDraft) {
        setSubmitPhase('publishing')
        const publishStart = performance.now()
        const publishResponse = await fetch(`/api/forecasts/${prediction.id}/publish`, {
          method: 'POST',
        })

        if (!publishResponse.ok) {
          const data = await publishResponse.json()
          throw new Error(data.error || t('errPublishFailed'))
        }
        recordDuration('forecast-publish', performance.now() - publishStart)
      }

      setSubmitPhase('done')

      window.dispatchEvent(new CustomEvent('daatan:first-action'))
      analytics.forecastCreated({
        outcome_type: formData.outcomeType,
        is_express: isExpressFlow,
      })

      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      router.push(`/forecasts/${prediction.slug || prediction.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errGeneric'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <StepNewsAnchor formData={formData} updateFormData={updateFormData} />
      case 2:
        return <StepPrediction formData={formData} updateFormData={updateFormData} />
      case 3:
        return <StepOutcome formData={formData} updateFormData={updateFormData} />
      case 4:
        return <StepPublish formData={formData} updateFormData={updateFormData} />
      default:
        return null
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return true // News anchor is optional
      case 2:
        return formData.claimText.length >= 10
      case 3: {
        const dateOk = !!(formData.resolveByDatetime && localEndOfDay(formData.resolveByDatetime) > new Date())
        const rulesOk = !!(formData.resolutionRules && formData.resolutionRules.trim().length >= 10)
        const optionsOk = formData.outcomeType !== 'MULTIPLE_CHOICE' ||
          (formData.outcomeOptions ?? []).filter(o => o.trim()).length >= 2
        return dateOk && rulesOk && optionsOk
      }
      case 4:
        return true
      default:
        return false
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress Steps */}
      <nav className="mb-8">
        <ol className="flex items-center justify-between">
          {STEPS.filter(step => !isExpressFlow || step.id !== 1).map((step, index, filteredSteps) => {
            const Icon = step.icon
            const isActive = currentStep === step.id
            const isCompleted = currentStep > step.id

            return (
              <li key={step.id} className="flex items-center min-w-0 flex-1">
                <button
                  onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                  disabled={step.id > currentStep}
                  className={`
                    flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg transition-colors w-full min-w-0
                    ${isActive ? 'bg-cobalt/10 text-blue-600' : ''}
                    ${isCompleted ? 'text-green-600 cursor-pointer hover:bg-teal/10' : ''}
                    ${!isActive && !isCompleted ? 'text-gray-400 cursor-not-allowed' : ''}
                  `}
                >
                  <div className={`
                    w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0
                    ${isActive ? 'bg-blue-600 text-white' : ''}
                    ${isCompleted ? 'bg-green-500 text-white' : ''}
                    ${!isActive && !isCompleted ? 'bg-navy-600' : ''}
                  `}>
                    {isCompleted ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : <Icon className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </div>
                  <div className="hidden sm:block text-left min-w-0">
                    <div className="font-medium text-sm truncate">{t(step.titleKey)}</div>
                    <div className="text-xs text-gray-500 truncate">{t(step.descKey)}</div>
                  </div>
                </button>
                {index < filteredSteps.length - 1 && (
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-300 mx-1 sm:mx-2 shrink-0" />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-800/50 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* "Same question" market match — offered after the claim step */}
      {marketMatch && !matchDismissed && !formData.externalMarketId && (
        <div className="mb-6 p-4 rounded-xl border border-pink-500/40 bg-pink-500/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-pink-400 mb-1">
                <TrendingUp className="w-4 h-4" />
                {t('marketMatch', { provider: marketMatch.providerLabel, score: marketMatch.score })}
              </div>
              <a
                href={marketMatch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-secondary hover:text-pink-300 inline-flex items-center gap-1"
              >
                <span className="truncate">{marketMatch.question}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
              <p className="mt-0.5 text-xs text-gray-500">{t('marketYes', { pct: marketMatch.yesProbability })}</p>
            </div>
            <button
              onClick={() => setMatchDismissed(true)}
              className="text-gray-400 hover:text-gray-200 shrink-0"
              aria-label={t('dismiss')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                updateFormData({ externalMarketId: marketMatch.externalMarketId })
                setMarketMatch(null)
              }}
              className="px-3 py-1.5 text-sm font-semibold bg-pink-600 hover:bg-pink-500 text-white rounded-lg"
            >
              {t('linkMarket')}
            </button>
            <button
              onClick={() => setMatchDismissed(true)}
              className="px-3 py-1.5 text-sm text-gray-300 hover:text-white"
            >
              {t('keepSeparate')}
            </button>
          </div>
        </div>
      )}

      {/* Linked-market confirmation */}
      {formData.externalMarketId && marketMatch && (
        <div className="mb-6 p-3 rounded-xl border border-pink-500/40 bg-pink-500/5 flex items-center gap-2 text-sm text-pink-300">
          <Check className="w-4 h-4" /> {t('linkedToMarket', { provider: marketMatch.providerLabel })}
        </div>
      )}

      {/* Step Content */}
      <div className="bg-navy-700 rounded-xl border border-navy-600 p-6 mb-6">
        {renderStep()}
      </div>

      {/* Navigation Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          onClick={handleBack}
          disabled={currentStep === (isExpressFlow ? 2 : 1)}
          variant="ghost"
          leftIcon={<ChevronLeft className="w-5 h-5" />}
        >
          {t('back')}
        </Button>

        <div className="flex gap-2 sm:gap-3">
          {currentStep === 4 ? (
            <>
              <Button
                onClick={() => handleSubmit(true)}
                loading={isSubmitting}
                variant="outline"
              >
                {t('saveDraft')}
              </Button>
              <Button
                onClick={() => handleSubmit(false)}
                loading={isSubmitting}
                disabled={!canProceed()}
                leftIcon={!isSubmitting && <Rocket className="w-5 h-5" />}
              >
                <span className="hidden sm:inline">{t('publishPrediction')}</span>
                <span className="sm:hidden">{t('publish')}</span>
              </Button>
            </>
          ) : (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              rightIcon={<ChevronRight className="w-5 h-5" />}
            >
              {t('next')}
            </Button>
          )}
        </div>
      </div>

      {isSubmitting && currentStep === 4 && (
        <SubmitProgress
          mode={submitMode}
          phase={submitPhase}
          createEstimateMs={estimates.create}
          publishEstimateMs={estimates.publish}
        />
      )}
    </div>
  )
}

