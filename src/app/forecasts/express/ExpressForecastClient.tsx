'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Search, FileText, Loader2, AlertCircle, Edit2, RotateCcw, ArrowLeft, X, Plus, List, Trash2, Eye, EyeOff, ShieldCheck, Newspaper, type LucideIcon } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/Button'
import { DateTimeField } from '@/components/ui/DateTimeField'
import { SimilarForecastsWarning } from '@/components/forecasts/SimilarForecastsWarning'
import { WarningBanner } from '@/components/ui/WarningBanner'
import { createClientLogger } from '@/lib/client-logger'
import { toLocalDatetimeInput } from '@/lib/utils/date'

const log = createClientLogger('ExpressForecast')

interface ExpressForecastClientProps {
  userId: string
  initialInput?: string
  onInputChange?: (val: string) => void
}

export interface GeneratedPrediction {
  claimText: string
  resolveByDatetime: string
  detailsText: string
  tags: string[]
  resolutionRules: string
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE'
  options: string[]
  probabilitySuggestion: number
  probabilityReasoning: string
  newsAnchor: {
    url: string
    title: string
    snippet: string
    source?: string
  } | null
  additionalLinks: Array<{
    url: string
    title: string
  }>
  externalMarketId?: string | null
  market?: {
    provider: string
    providerLabel: string
    question: string
    url: string
    probability: number | null
  } | null
  ungroundedYears?: string[]
  localized?: {
    language: string
    claimText: string
    detailsText: string
    resolutionRules: string
    options: string[]
  } | null
}

type Step = 'input' | 'checking' | 'searching' | 'analyzing' | 'generating' | 'review' | 'error'

export default function ExpressForecastClient({
  userId,
  initialInput = '',
  onInputChange
}: ExpressForecastClientProps) {
  const t = useTranslations('expressForecast')
  const locale = useLocale()
  const router = useRouter()

  const ANALYZING_MESSAGES = useMemo(() => [
    t('analyzingReading'),
    t('analyzingIdentifying'),
    t('analyzingDrafting'),
    t('analyzingCalibrating'),
    t('analyzingEstimating'),
    t('analyzingAlmostThere'),
  ], [t])
  const [userInput, setUserInput] = useState(initialInput)
  const [analyzingMsgIdx, setAnalyzingMsgIdx] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const startTimeRef = useRef<number | null>(null)

  const handleUserInputChange = (val: string) => {
    setUserInput(val)
    onInputChange?.(val)
  }
  const [step, setStep] = useState<Step>('input')
  // 1..5 honest progress phase for the stepper (0 = idle):
  // 1 check · 2 search · 3 found · 4 analyze+draft · 5 finalize
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState<GeneratedPrediction | null>(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [articlesFound, setArticlesFound] = useState(0)
  const [sourcesSummary, setSourcesSummary] = useState('')
  const [predictionPreview, setPredictionPreview] = useState<{ claim: string; resolveBy: string } | null>(null)

  const [skipSources, setSkipSources] = useState(false)
  const [noArticlesDetails, setNoArticlesDetails] = useState<{
    searchedFor: string
    isUrl: boolean
    isNonLatin: boolean
  } | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  // Non-null when the user typed in a non-English language: the preview/edit is shown in
  // that language; the English canonical is re-derived on create (createForecast).
  const [originalLang, setOriginalLang] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isGuessing, setIsGuessing] = useState(false)
  const [isPublic, setIsPublic] = useState(true)
  const [editForm, setEditForm] = useState<GeneratedPrediction | null>(null)
  const [newTag, setNewTag] = useState('')

  // Rotate analyzing sub-messages every 4s, run elapsed timer during long steps
  useEffect(() => {
    const isLongStep = ['checking', 'searching', 'analyzing', 'generating'].includes(step)
    if (!isLongStep) {
      startTimeRef.current = null
      setElapsedSeconds(0)
      setAnalyzingMsgIdx(0)
      return
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now()

    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current!) / 1000))
      if (step === 'analyzing') {
        setAnalyzingMsgIdx(i => (i + 1) % ANALYZING_MESSAGES.length)
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [step, ANALYZING_MESSAGES.length])

  const examples = [
    t('exampleBitcoin'),
    t('exampleChampionsLeague'),
    t('exampleTuringTest'),
    t('exampleOlympics'),
  ]

  const handleGenerate = async () => {
    if (!userInput.trim() || userInput.length < 5) {
      setError(t('minCharError'))
      return
    }

    // URL detection for UI feedback — a link pasted anywhere (even alongside
    // text) is honored as the news anchor server-side, so flag it here too.
    const isUrl = /https?:\/\/[^\s]+/i.test(userInput)

    setError('')
    setStep('checking')
    setPhase(1)
    setProgressMessage(t('checkingMsg'))
    setArticlesFound(0)
    setSourcesSummary('')
    setPredictionPreview(null)

    try {
      const response = await fetch('/api/forecasts/express/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, skipSources }),
      })

      if (!response.ok) {
        throw new Error(t('failedGenerate'))
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error(t('failedGenerate'))
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)

            if (data.stage === 'checking') {
              setStep('checking')
              setPhase(1)
              setProgressMessage(data.data?.message || t('checkingMsg'))
            } else if (data.stage === 'searching') {
              setStep('searching')
              setPhase(2)
              setProgressMessage(data.data?.message || t('searchingMsg'))
            } else if (data.stage === 'found_articles') {
              setArticlesFound(data.data?.count || 0)
              setSourcesSummary(data.data?.sources || '')
              setProgressMessage(data.data?.message || t('foundSources', { count: data.data?.count ?? 0 }))
              setStep('analyzing')
              setPhase(3)
            } else if (data.stage === 'analyzing') {
              setStep('analyzing')
              setPhase(4)
              setProgressMessage(data.data?.message || t('analyzingMsg'))
            } else if (data.stage === 'prediction_formed') {
              setStep('generating')
              setPhase(5)
              setProgressMessage(data.data?.message || t('predictionFormed'))
              if (data.data?.preview) {
                setPredictionPreview(data.data.preview)
              }
            } else if (data.stage === 'finalizing') {
              setPhase(5)
              setProgressMessage(data.data?.message || t('finalizingMsg'))
            } else if (data.stage === 'complete') {
              // Non-Latin input → show/edit the preview in the author's language; the
              // English fields stay under the hood (createForecast re-derives them).
              const loc = data.data.localized
              const display = loc
                ? { ...data.data, claimText: loc.claimText, detailsText: loc.detailsText, resolutionRules: loc.resolutionRules, options: loc.options }
                : data.data
              setOriginalLang(loc?.language ?? null)
              setGenerated(display)
              setEditForm(display) // Initialize edit form
              setStep('review')
            } else if (data.stage === 'error') {
              if (data.error === 'NO_ARTICLES_FOUND') {
                setError(data.message || t('noArticlesFound'))
                if (data.details) setNoArticlesDetails(data.details)
              } else if (data.error === 'OFFENSIVE_INPUT') {
                setError(data.message)
              } else if (data.message?.startsWith('OFFENSIVE_INPUT:')) {
                const aiReason = data.message.split('OFFENSIVE_INPUT:')[1].trim()
                setError(t('moderationPrefix', { reason: aiReason }))
              } else {
                setError(data.message || t('failedGenerate'))
              }
              setStep('error')
            }
          } catch (e) {
            log.error({ err: e }, 'Failed to parse stream data')
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('somethingWrong'))
      setStep('error')
    }
  }

  const handleTryAgain = () => {
    setStep('input')
    setPhase(0)
    setError('')
    setGenerated(null)
    setEditForm(null)
    setIsEditing(false)
    setOriginalLang(null)
    setProgressMessage('')
    setArticlesFound(0)
    setSourcesSummary('')
    setPredictionPreview(null)
    setNoArticlesDetails(null)
  }

  const handleSkipSourcesAndRetry = () => {
    setSkipSources(true)
    setNoArticlesDetails(null)
    setError('')
    handleGenerate()
  }

  const handleRegenerateFromEdit = () => {
    if (editForm?.claimText) {
      setUserInput(editForm.claimText)
      setStep('input')
      setIsEditing(false)
      // Delay to ensure state update before triggering
      setTimeout(() => {
        handleGenerate()
      }, 50)
    }
  }

  const handleGuessChances = async () => {
    if (!generated) return
    setIsGuessing(true)
    setError('')

    try {
      const articles = [
        ...(generated.newsAnchor ? [{ title: generated.newsAnchor.title, source: generated.newsAnchor.source || 'News', snippet: generated.newsAnchor.snippet }] : []),
        ...generated.additionalLinks.map(l => ({ title: l.title, source: 'Related', snippet: '' }))
      ]

      const response = await fetch('/api/forecasts/express/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimText: generated.claimText,
          detailsText: generated.detailsText,
          articles,
          marketProbability: generated.market?.probability ?? undefined,
        }),
      })

      if (!response.ok) throw new Error(t('guessError'))
      const result = await response.json()

      setGenerated({
        ...generated,
        probabilitySuggestion: result.probability,
        probabilityReasoning: result.reasoning
      })
    } catch (err) {
      log.error({ err }, 'Guess chances error')
      setError(t('guessError'))
    } finally {
      setIsGuessing(false)
    }
  }

  const handleCreatePrediction = async () => {
    const finalData = isEditing ? editForm : generated
    if (!finalData) return

    const resolveBy = new Date(finalData.resolveByDatetime)
    if (isNaN(resolveBy.getTime()) || resolveBy <= new Date()) {
      setError(t('resolutionDateFutureError'))
      return
    }

    setIsPublishing(true)
    setError('')

    try {
      // 1. Create the prediction (as draft)
      const createResponse = await fetch('/api/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimText: finalData.claimText,
          detailsText: finalData.detailsText,
          resolutionRules: finalData.resolutionRules,
          resolveByDatetime: finalData.resolveByDatetime,
          outcomeType: finalData.outcomeType,
          outcomePayload: finalData.outcomeType === 'MULTIPLE_CHOICE' ? { options: finalData.options } : undefined,
          tags: finalData.tags,
          newsAnchorUrl: finalData.newsAnchor?.url || undefined,
          newsAnchorTitle: finalData.newsAnchor?.title || undefined,
          source: (finalData.newsAnchor || finalData.externalMarketId) ? undefined : 'manual',
          externalMarketId: finalData.externalMarketId || undefined,
          isPublic,
          confidence: finalData.probabilitySuggestion || undefined,
        }),
      })

      if (!createResponse.ok) {
        const errData = await createResponse.json()
        throw new Error(errData.error || t('createFailed'))
      }

      const prediction = await createResponse.json()

      // 2. Publish the prediction (DRAFT -> ACTIVE)
      const publishResponse = await fetch(`/api/forecasts/${prediction.id}/publish`, {
        method: 'POST',
      })

      if (!publishResponse.ok) {
        const errData = await publishResponse.json()
        throw new Error(errData.error || t('publishFailed'))
      }

      // Success: redirect to the new prediction page
      router.push(`/forecasts/${prediction.id}?newly_created=true`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('publishError'))
      setIsPublishing(false)
    }
  }

  const handleSaveEdit = () => {
    if (editForm) {
      // A flagged year stays suspect until it's gone from both the claim and the
      // date — an edit that leaves it in place hasn't fixed it. Any year the
      // author types themselves is grounded by definition, so filtering the
      // original flags is enough.
      const ungroundedYears = (generated?.ungroundedYears ?? []).filter(
        y => editForm.claimText.includes(y) || editForm.resolveByDatetime.startsWith(y),
      )
      setGenerated({ ...editForm, ungroundedYears })
      setIsEditing(false)
    }
  }

  // editForm stores a UTC ISO string; DateTimeField takes local "YYYY-MM-DDTHH:MM"
  // (and holds '' after invalid input).
  const resolveByDate = editForm?.resolveByDatetime ? new Date(editForm.resolveByDatetime) : null
  const resolveByInputValue = resolveByDate && !isNaN(resolveByDate.getTime())
    ? toLocalDatetimeInput(resolveByDate)
    : ''

  // Tag management in edit mode
  const addTag = () => {
    if (newTag && editForm && !editForm.tags?.includes(newTag)) {
      setEditForm({
        ...editForm,
        tags: [...(editForm.tags || []), newTag]
      })
      setNewTag('')
    }
  }

  const removeTag = (tag: string) => {
    if (editForm) {
      setEditForm({
        ...editForm,
        tags: (editForm.tags || []).filter(t => t !== tag)
      })
    }
  }

  // Option management in edit mode
  const handleOptionChange = (index: number, value: string) => {
    if (!editForm) return
    const newOptions = [...(editForm.options || [])]
    newOptions[index] = value
    setEditForm({ ...editForm, options: newOptions })
  }

  const addOption = () => {
    if (!editForm) return
    if ((editForm.options || []).length < 10) {
      setEditForm({ ...editForm, options: [...(editForm.options || []), ''] })
    }
  }

  const removeOption = (index: number) => {
    if (!editForm) return
    const newOptions = (editForm.options || []).filter((_, i) => i !== index)
    setEditForm({ ...editForm, options: newOptions })
  }

  // Five honest progress rows. The search + found rows drop out for the
  // source-free path (skipSources), which goes check → analyze → finalize.
  type StepperRow = { n: number; Icon: LucideIcon; label: string; detail?: string | null; pulse?: boolean }
  const stepperRows: StepperRow[] = [
    { n: 1, Icon: ShieldCheck, label: t('checkingStep') },
    ...(!skipSources
      ? [
          { n: 2, Icon: Search, label: t('searchingStep') },
          {
            n: 3,
            Icon: Newspaper,
            label: t('foundStep'),
            detail: articlesFound > 0 ? (sourcesSummary || t('sourcesFound', { count: articlesFound })) : null,
          },
        ]
      : []),
    { n: 4, Icon: FileText, label: t('aiAnalysisStep'), detail: phase === 4 ? ANALYZING_MESSAGES[analyzingMsgIdx] : null, pulse: true },
    { n: 5, Icon: Sparkles, label: t('finalizeStep') },
  ]

  return (
    <div className="space-y-6">
      {/* Input Step */}
      {step === 'input' && (
        <div className="bg-navy-700 border border-navy-600 rounded-3xl p-6 sm:p-8 shadow-sm">
          <label htmlFor="prediction-input" className="block text-sm font-bold text-text-secondary mb-3">
            {t('inputLabel')}
          </label>
          <textarea
            id="prediction-input"
            value={userInput}
            onChange={(e) => handleUserInputChange(e.target.value)}
            placeholder={t('inputPlaceholder')}
            className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle border border-navy-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent resize-none"
            rows={3}
            maxLength={1000} // Increased for URLs
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-500">{t('charCount', { count: userInput.length })}</span>
            {/https?:\/\/[^\s]+/i.test(userInput) && (
              <span className="text-xs text-blue-600 font-medium">{t('urlDetected')}</span>
            )}
          </div>

          <label className="flex items-center gap-3 mt-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipSources}
              onChange={(e) => setSkipSources(e.target.checked)}
              className="w-4 h-4 rounded border-navy-500 bg-navy-800 accent-cobalt"
            />
            <span className="text-sm text-text-secondary">
              {t('skipSources')}
              <span className="block text-xs text-gray-500 font-normal">{t('skipSourcesHint')}</span>
            </span>
          </label>

          {error && (
            <div className="mt-4 bg-red-900/20 border border-red-800/50 text-red-400 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={!userInput.trim() || userInput.length < 5}
            fullWidth
            size="xl"
            leftIcon={<Sparkles className="w-5 h-5" />}
            className="mt-6"
          >
            {t('generate')}
          </Button>

          <div className="mt-8 pt-6 border-t border-navy-600">
            <p className="text-sm font-bold text-text-secondary mb-3">{t('examplesLabel')}</p>
            <div className="space-y-2">
              {examples.map((example, i) => (
                <button
                  key={i}
                  onClick={() => setUserInput(example)}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-navy-800 rounded-lg transition-colors truncate"
                >
                  • {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Progress Steps */}
      {(['checking', 'searching', 'analyzing', 'generating'] as Step[]).includes(step) && (
        <div className="bg-navy-700 border border-navy-600 rounded-3xl p-8 shadow-sm">
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-center mb-6">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            </div>

            <div className="space-y-4">
              {stepperRows.map((row) => {
                const state = phase > row.n ? 'done' : phase === row.n ? 'active' : 'pending'
                const Icon = row.Icon
                return (
                  <div
                    key={row.n}
                    className={`flex items-center gap-3 ${
                      state === 'active' ? 'text-blue-600' : state === 'done' ? 'text-green-600' : 'text-gray-500'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <div className="flex-1">
                      <span className="font-medium">{row.label}</span>
                      {row.detail && (row.pulse
                        ? <p className="text-xs text-gray-400 mt-0.5 animate-pulse">{row.detail}</p>
                        : <span className="ml-2 text-sm text-gray-400">({row.detail})</span>
                      )}
                    </div>
                    {state === 'done' && <span className="text-green-600 text-sm">✓</span>}
                  </div>
                )
              })}
            </div>

            {/* Current status message + elapsed timer */}
            <div className="mt-5 flex items-center justify-between text-xs text-gray-500">
              <span className="italic">{progressMessage}</span>
              {elapsedSeconds > 2 && (
                <span className="tabular-nums">{elapsedSeconds}s</span>
              )}
            </div>

            {predictionPreview && (
              <div className="mt-6 p-4 bg-cobalt/10 border border-cobalt/30 rounded-xl">
                <p className="text-sm font-bold text-blue-900 mb-2">{t('previewLabel')}</p>
                <p className="text-sm text-cobalt-light">{predictionPreview.claim}</p>
                <p className="text-xs text-blue-600 mt-1">
                  {t('resolvesOn', { date: new Date(predictionPreview.resolveBy).toLocaleDateString() })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Step */}
      {step === 'error' && (
        <div className="bg-navy-700 border border-navy-600 rounded-3xl p-8 shadow-sm">
          <div className="max-w-md mx-auto text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t('errorTitle')}</h3>
            <p className="text-gray-300 mb-4">{error}</p>
            {noArticlesDetails && (
              <div className="text-left text-sm bg-navy-800 border border-navy-600 rounded-lg p-4 mb-4 space-y-2">
                <div>
                  <span className="text-gray-400">{t('searchedFor')}: </span>
                  <span className="text-white font-mono break-words">{noArticlesDetails.searchedFor}</span>
                </div>
                <div className="text-gray-300">{t('whatToTryNextHeader')}</div>
                <ul className="list-disc list-inside text-gray-300 space-y-1">
                  <li>{t('hintRephrase')}</li>
                  {noArticlesDetails.isNonLatin && <li>{t('hintTryEnglish')}</li>}
                  {noArticlesDetails.isUrl && <li>{t('hintUrlFailed')}</li>}
                  <li>{t('hintBeMoreSpecific')}</li>
                </ul>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleTryAgain}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
              >
                {t('tryAgain')}
              </button>
              {noArticlesDetails && (
                <button
                  onClick={handleSkipSourcesAndRetry}
                  className="bg-navy-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-navy-500 transition-colors border border-navy-500"
                >
                  {t('skipSourcesAndRetry')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review Step */}
      {step === 'review' && generated && (
        <div className="bg-navy-700 border border-navy-600 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex justify-between items-start border-b border-navy-600 pb-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">{t('reviewTitle')}</h2>
              <p className="text-sm text-gray-300">
                {t('reviewSubtitle')}
              </p>
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <button
                  onClick={handleRegenerateFromEdit}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 bg-purple-900/20 rounded-lg hover:bg-purple-100 transition-colors"
                  title={t('regenerateFromClaimTooltip')}
                >
                  <Sparkles className="w-4 h-4" />
                  {t('regenerate')}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleGenerate}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-cobalt/10 rounded-lg transition-colors"
                    title={t('regenerate')}
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { setIsEditing(true); setEditForm(generated) }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-cobalt/10 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    {t('edit')}
                  </button>
                </>
              )}
            </div>
          </div>

          {originalLang && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-500/30 bg-cobalt/10 px-4 py-3 text-sm text-blue-300">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {t('reviewInOriginal', {
                  language: new Intl.DisplayNames([locale], { type: 'language' }).of(originalLang) || originalLang,
                })}
              </span>
            </div>
          )}

          <div className="space-y-6">
            {/* Claim */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('forecastClaim')}</h3>
              {isEditing ? (
                <textarea
                  dir="auto"
                  aria-label="Claim text"
                  value={editForm?.claimText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditForm(prev => prev ? ({ ...prev, claimText: e.target.value }) : null)}
                  className="w-full p-3 rounded-lg border border-navy-600 bg-navy-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              ) : (
                <p className="text-lg text-white" dir="auto">{generated.claimText}</p>
              )}
            </div>

            {!isEditing && (
              <SimilarForecastsWarning claimText={generated.claimText} tags={generated.tags} />
            )}

            {!isEditing && generated.ungroundedYears && generated.ungroundedYears.length > 0 && (
              <WarningBanner
                icon={<AlertCircle className="w-4 h-4" />}
                title={t('dateWarningTitle', { years: generated.ungroundedYears.join(', ') })}
              >
                <p className="text-xs text-gray-500">{t('dateWarningHint')}</p>
              </WarningBanner>
            )}

            {/* Resolution Date */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('resolutionDate')}</h3>
              {isEditing ? (
                <DateTimeField
                  value={resolveByInputValue}
                  onChange={(value) => {
                    setEditForm(prev => prev ? ({ ...prev, resolveByDatetime: value ? new Date(value).toISOString() : '' }) : null)
                  }}
                  defaultTime="23:59"
                  min={toLocalDatetimeInput(new Date()).slice(0, 10)}
                  invalid={!!(resolveByDate && resolveByDate <= new Date())}
                />
              ) : (
                <p className="text-white">
                  {new Date(generated.resolveByDatetime).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                </p>
              )}
            </div>

            {/* Tags */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('tags')}</h3>
              <div className="flex flex-wrap gap-2">
                {(isEditing ? editForm?.tags : generated.tags)?.map((tag: string, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-navy-700 text-text-secondary rounded-full text-sm">
                    {tag}
                    {isEditing && (
                      <button onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
                {isEditing && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addTag()}
                      placeholder={t('addTagPlaceholder')}
                      aria-label={t('addTagPlaceholder')}
                      className="px-3 py-1 rounded-full text-sm w-32 border border-navy-600 bg-navy-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button onClick={addTag} aria-label="Add tag" className="p-1 text-blue-600 hover:bg-cobalt/10 rounded-full">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Outcome Type & Options */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('outcomeType')}</h3>
              <div className="flex items-center gap-2 mb-3">
                {generated.outcomeType === 'MULTIPLE_CHOICE' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                    <List className="w-4 h-4" />
                    {t('multipleChoice')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-cobalt-light rounded-full text-sm font-medium">
                    {t('binary')}
                  </span>
                )}
              </div>
              {((isEditing ? editForm?.outcomeType : generated.outcomeType) === 'MULTIPLE_CHOICE') && (
                <div>
                  <h4 className="text-sm font-medium text-gray-300 mb-2">{t('options')}</h4>
                  {isEditing ? (
                    <div className="space-y-2">
                      {(editForm?.options || []).map((option: string, index: number) => (
                        <div key={index} className="flex gap-2">
                          <span className="flex items-center justify-center w-8 text-sm text-gray-400">
                            {index + 1}.
                          </span>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => handleOptionChange(index, e.target.value)}
                            placeholder={t('optionPlaceholder', { n: index + 1 })}
                            aria-label={t('optionPlaceholder', { n: index + 1 })}
                            className="flex-1 px-3 py-2 rounded-lg text-sm border border-navy-600 bg-navy-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            maxLength={500}
                          />
                          {(editForm?.options || []).length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeOption(index)}
                              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                              aria-label={t('removeOptionLabel', { n: index + 1 })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      {(editForm?.options || []).length < 10 && (
                        <button
                          type="button"
                          onClick={addOption}
                          className="flex items-center gap-1.5 text-blue-600 hover:text-cobalt-light text-sm mt-1"
                        >
                          <Plus className="w-4 h-4" />
                          {t('addOption')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <ol className="space-y-1.5">
                      {(generated.options || []).map((option, index) => (
                        <li key={index} className="flex items-center gap-2 text-mist">
                          <span className="flex items-center justify-center w-6 h-6 bg-navy-700 text-gray-500 rounded-full text-xs font-medium">
                            {index + 1}
                          </span>
                          {option}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>

            {/* Context */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('context')}</h3>
              {isEditing ? (
                <textarea
                  dir="auto"
                  aria-label="Context"
                  value={editForm?.detailsText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditForm(prev => prev ? ({ ...prev, detailsText: e.target.value }) : null)}
                  className="w-full p-3 rounded-lg border border-navy-600 bg-navy-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                />
              ) : (
                <p className="text-text-secondary" dir="auto">{generated.detailsText}</p>
              )}
            </div>

            {/* Resolution Rules */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary mb-2">{t('resolutionRules')}</h3>
              {isEditing ? (
                <textarea
                  dir="auto"
                  aria-label="Resolution rules"
                  value={editForm?.resolutionRules}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditForm(prev => prev ? ({ ...prev, resolutionRules: e.target.value }) : null)}
                  className="w-full p-3 rounded-lg border border-navy-600 bg-navy-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              ) : (
                <p className="text-text-secondary italic" dir="auto">{generated.resolutionRules}</p>
              )}
            </div>

            {/* AI Probability Suggestion */}
            {!isEditing && (
              <div className="p-4 bg-purple-900/20 border border-purple-100 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    {t('aiProbabilityGuess')}
                  </h3>
                  {!generated.probabilitySuggestion && (
                    <Button
                      onClick={handleGuessChances}
                      loading={isGuessing}
                      size="sm"
                      variant="outline"
                      className="text-xs py-1 h-auto"
                    >
                      {t('guessChances')}
                    </Button>
                  )}
                </div>
                {generated.probabilitySuggestion ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-black text-purple-600">
                        {generated.probabilitySuggestion}%
                      </div>
                      <div className="text-sm text-purple-800 leading-tight">
                        {generated.probabilityReasoning}
                      </div>
                    </div>
                    <button
                      onClick={handleGuessChances}
                      className="text-[10px] uppercase tracking-wider font-bold text-purple-400 hover:text-purple-600 transition-colors"
                    >
                      {t('recalculate')}
                    </button>
                  </div>
                ) : !isGuessing && (
                  <p className="text-xs text-purple-600/70">
                    {t('probabilityHint')}
                  </p>
                )}
              </div>
            )}

            {/* Linked market */}
            {generated.market && (
              <div>
                <h3 className="text-sm font-bold text-text-secondary mb-2">{t('marketLinked')}</h3>
                <a
                  href={generated.market.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-4 p-4 border border-emerald-500/30 bg-emerald-500/10 rounded-xl hover:border-emerald-400 transition-colors"
                >
                  <div>
                    <p className="font-medium text-white mb-1">{generated.market.question}</p>
                    <p className="text-sm text-gray-500">{generated.market.providerLabel}</p>
                  </div>
                  {generated.market.probability != null && (
                    <div className="text-2xl font-black text-emerald-400 shrink-0">
                      {generated.market.probability}%
                    </div>
                  )}
                </a>
              </div>
            )}

            {/* News Anchor */}
            {generated.newsAnchor ? (
              <div>
                <h3 className="text-sm font-bold text-text-secondary mb-2">{t('newsAnchor')}</h3>
                <a
                  href={generated.newsAnchor.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 border border-navy-600 rounded-xl hover:border-blue-300 hover:bg-cobalt/10 transition-colors"
                >
                  <p className="font-medium text-white mb-1">{generated.newsAnchor.title}</p>
                  {generated.newsAnchor.source && (
                    <p className="text-sm text-gray-500">{generated.newsAnchor.source}</p>
                  )}
                </a>
              </div>
            ) : generated.market ? null : (
              <div>
                <h3 className="text-sm font-bold text-text-secondary mb-2">{t('sourceLabel')}</h3>
                <div className="p-4 border border-purple-500/30 bg-purple-500/10 rounded-xl">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-400 px-2 py-0.5 bg-purple-500/20 rounded-full mb-1">{t('personal')}</span>
                  <p className="text-sm text-gray-400">{t('personalHint')}</p>
                </div>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-navy-600 space-y-3">
            {/* Visibility toggle */}
            {!isEditing && (
              <button
                type="button"
                onClick={() => setIsPublic(v => !v)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                  isPublic
                    ? 'bg-teal/10 text-teal border-green-200 hover:bg-green-100'
                    : 'bg-navy-800 text-gray-400 border-navy-600 hover:bg-navy-700'
                }`}
              >
                <span>{isPublic ? t('visibilityPublic') : t('visibilityUnlisted')}</span>
                {isPublic ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            )}

            <div className="flex gap-3">
              {isEditing ? (
                <>
                  <Button
                    onClick={handleSaveEdit}
                    fullWidth
                    size="xl"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {t('saveChanges')}
                  </Button>
                  <Button
                    onClick={() => { setIsEditing(false); setEditForm(null) }}
                    variant="outline"
                    size="xl"
                  >
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleCreatePrediction}
                    loading={isPublishing}
                    fullWidth
                    size="xl"
                    leftIcon={<Sparkles className="w-5 h-5" />}
                  >
                    {t('confirmPublish')}
                  </Button>
                  <Button
                    onClick={handleTryAgain}
                    disabled={isPublishing}
                    variant="outline"
                    size="xl"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
