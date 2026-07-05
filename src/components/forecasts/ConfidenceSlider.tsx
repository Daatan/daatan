'use client'

import { CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

interface ConfidenceSliderProps {
  value: number
  onChange: (value: number) => void
  onCommit: () => void
  isSubmitting?: boolean
  disabled?: boolean
  canCommit?: boolean
  isCommitted?: boolean
}

export default function ConfidenceSlider({
  value,
  onChange,
  onCommit,
  isSubmitting = false,
  disabled = false,
  canCommit = true,
  isCommitted = false,
}: ConfidenceSliderProps) {
  const t = useTranslations('commitment.confidenceLabel')
  const tf = useTranslations('forecast')

  const getLabel = (val: number) => {
    if (val <= 5)  return t('almostCertainNo')
    if (val <= 15) return t('veryLikelyNo')
    if (val <= 25) return t('probablyNo')
    if (val <= 35) return t('leaningNo')
    if (val < 50)  return t('slightlyNo')
    if (val === 50) return t('neutral')
    if (val < 65)  return t('slightlyYes')
    if (val < 75)  return t('leaningYes')
    if (val < 85)  return t('probablyYes')
    if (val < 95)  return t('veryLikelyYes')
    return t('almostCertainYes')
  }

  const isNeutral = value === 50

  const outcome = useMemo(() => value > 50 ? tf('willHappen') : value < 50 ? tf('wontHappen') : null, [value, tf])

  return (
    <div className="w-full space-y-6 py-4">
      <div className="space-y-4">
        <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-gray-500">
          <span className="text-red-400">0% {tf('wontHappen')}</span>
          <span>50 {tf('neutral')}</span>
          <span className="text-teal">100% {tf('willHappen')}</span>
        </div>

        <div className="relative group">
          <input
            type="range"
            min="0"
            max="100"
            step="any"
            value={value}
            onChange={(e) => onChange(Math.round(parseFloat(e.target.value)))}
            disabled={disabled || isSubmitting}
            aria-label="Confidence"
            className="w-full h-3 bg-navy-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all border border-navy-600 shadow-inner"
          />
          {/* Midpoint mark at 50 */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-navy-600 -translate-x-1/2 pointer-events-none" />
        </div>

        <div className="text-center">
          <div className={`text-xl font-black uppercase tracking-tighter ${
            value > 50 ? 'text-teal' : value < 50 ? 'text-red-400' : 'text-gray-500'
          }`}>
            {getLabel(value)}
          </div>
          {outcome && (
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">
              {tf('myEstimate', { outcome, confidence: value })}
            </div>
          )}
        </div>
      </div>

      {isCommitted && !canCommit && !isSubmitting ? (
        <div className="flex items-center justify-center gap-2 py-4 px-4 bg-teal/10 border border-teal/30 rounded-xl">
          <CheckCircle2 className="w-4 h-4 text-teal" />
          <span className="text-sm font-bold text-teal uppercase tracking-widest">{tf('yourForecastCommitted')}</span>
        </div>
      ) : (
        <button
          onClick={onCommit}
          disabled={isNeutral || disabled || isSubmitting || !canCommit}
          className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 ${
            isNeutral || disabled || isSubmitting || !canCommit
              ? 'bg-navy-800 text-gray-600 cursor-not-allowed border border-navy-600'
              : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20 active:scale-[0.98] border border-blue-400/30'
          }`}
        >
          {isSubmitting ? tf('submitting') : tf('commitForecastButton')}
        </button>
      )}
    </div>
  )
}
