'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { analytics } from '@/lib/analytics'

interface PredictionOption {
  id: string
  text: string
}

interface Prediction {
  id: string
  outcomeType: string
  options?: PredictionOption[]
  lockedAt?: string | null
}

interface ExistingCommitment {
  id: string
  cuCommitted: number   // stores confidence value (-100..100)
  binaryChoice?: boolean
  optionId?: string
}

interface Commitment {
  id: string
  cuCommitted: number
  binaryChoice?: boolean
  optionId?: string
  predictionId: string
  userId: string
}

interface CommitmentFormProps {
  prediction: Prediction
  existingCommitment?: ExistingCommitment
  onSuccess: (commitment: Commitment) => void
  onCancel?: () => void
}

function ConfidenceInput({
  value,
  onChange,
  min = -100,
  max = 100,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) {
  const getLabel = (val: number) => {
    if (min === 0) {
      if (val >= 90) return 'Very confident'
      if (val >= 60) return 'Confident'
      if (val >= 30) return 'Somewhat confident'
      return 'Low confidence'
    }
    if (val === 0) return 'Neutral'
    if (val <= -70) return 'Probably NO'
    if (val < 0) return 'Leaning NO'
    if (val >= 70) return 'Probably YES'
    return 'Leaning YES'
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-gray-500">
        {min === 0 ? (
          <><span>Low</span><span className="text-teal">High</span></>
        ) : (
          <><span className="text-red-400">NO</span><span>Neutral</span><span className="text-teal">YES</span></>
        )}
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          disabled={disabled}
          aria-label="Confidence"
          className="w-full h-3 bg-navy-800 rounded-lg appearance-none cursor-pointer accent-blue-500 border border-navy-600"
        />
        {min === -100 && (
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-navy-600 -translate-x-1/2 pointer-events-none" />
        )}
      </div>
      <div className="text-center">
        <span className={`text-sm font-bold ${value > 0 ? 'text-teal' : value < 0 ? 'text-red-400' : 'text-gray-500'}`}>
          {getLabel(value)}
        </span>
        <span className="text-xs text-gray-500 ml-2">
          ({value > 0 ? '+' : ''}{value})
        </span>
      </div>
    </div>
  )
}

export default function CommitmentForm({
  prediction,
  existingCommitment,
  onSuccess,
  onCancel,
}: CommitmentFormProps) {
  const t = useTranslations('commitment')
  const isUpdate = !!existingCommitment

  const initialConfidence = existingCommitment?.cuCommitted ?? 70
  const [confidence, setConfidence] = useState<number>(initialConfidence)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (optionOrBool?: string | boolean) => {
    setError(null)
    setIsSubmitting(true)

    try {
      const endpoint = `/api/forecasts/${prediction.id}/commit`
      const method = isUpdate ? 'PATCH' : 'POST'
      const body: Record<string, unknown> = {}

      if (prediction.outcomeType === 'BINARY') {
        // Ensure sign matches the chosen direction
        let finalConfidence = confidence
        if (typeof optionOrBool === 'boolean') {
          finalConfidence = optionOrBool ? Math.abs(confidence) : -Math.abs(confidence)
          if (finalConfidence === 0) finalConfidence = optionOrBool ? 1 : -1
        }
        body.confidence = finalConfidence
      } else {
        const optId = typeof optionOrBool === 'string' ? optionOrBool : null
        if (!optId) {
          setError('Please select an option')
          setIsSubmitting(false)
          return
        }
        body.confidence = Math.max(1, Math.abs(confidence))
        body.optionId = optId
      }

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save commitment')
      }

      const result = await response.json()
      window.dispatchEvent(new CustomEvent('daatan:first-action'))
      analytics.commitmentMade({ forecast_id: prediction.id, cu_committed: Math.abs(body.confidence as number) })
      onSuccess(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  const isCurrentOption = (val: string | boolean) => {
    if (!existingCommitment) return false
    if (prediction.outcomeType === 'BINARY') return existingCommitment.binaryChoice === val
    return existingCommitment.optionId === val
  }

  return (
    <div className="space-y-4 rounded-xl border border-cobalt/30 bg-cobalt/10/30 p-4 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          {isUpdate ? t('updateCommitment') : t('makeCommitment')}
          {isUpdate && (
            <span className="text-xs font-medium text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">✓ Voted</span>
          )}
        </h3>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={isSubmitting}
            className="text-sm font-medium text-gray-500 hover:text-text-secondary disabled:opacity-50">
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-900/20 p-3 text-sm text-red-400">{error}</div>
      )}

      <ConfidenceInput
        value={confidence}
        onChange={setConfidence}
        min={prediction.outcomeType === 'MULTIPLE_CHOICE' ? 0 : -100}
        disabled={isSubmitting}
      />

      {prediction.outcomeType === 'BINARY' ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => handleSubmit(true)} disabled={isSubmitting}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all shadow-sm ${
              isCurrentOption(true) ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-navy-700 text-text-secondary hover:bg-teal/10 hover:text-teal'
            } disabled:opacity-50 disabled:cursor-not-allowed`}>
            {isSubmitting ? '...' : isUpdate && isCurrentOption(true) ? t('update') : t('willHappen')}
          </button>
          <button type="button" onClick={() => handleSubmit(false)} disabled={isSubmitting}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all shadow-sm ${
              isCurrentOption(false) ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-navy-700 text-text-secondary hover:bg-red-900/20 hover:text-red-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}>
            {isSubmitting ? '...' : isUpdate && isCurrentOption(false) ? t('update') : t('wontHappen')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {prediction.options?.map((option) => (
            <button key={option.id} type="button" onClick={() => handleSubmit(option.id)} disabled={isSubmitting}
              className={`w-full text-left rounded-lg px-4 py-3 text-sm font-medium transition-all shadow-sm flex items-center justify-between ${
                isCurrentOption(option.id) ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-navy-700 text-white hover:bg-cobalt/10 hover:text-cobalt-light'
              } disabled:opacity-50 disabled:cursor-not-allowed`}>
              <span>{option.text}</span>
              <span className={`text-xs ${isCurrentOption(option.id) ? 'text-blue-100' : 'text-gray-400'}`}>
                {isSubmitting ? '...' : isCurrentOption(option.id) ? t('update') : t('select')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
