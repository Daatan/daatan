import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { PredictionFormData } from '../ForecastWizard'
import { TagSelector } from '@/components/ui/TagSelector'
import { SimilarForecastsWarning } from '../SimilarForecastsWarning'
import { createClientLogger } from '@/lib/client-logger'
import { useCapabilities } from '@/components/CapabilitiesProvider'

const log = createClientLogger('StepPrediction')

type Props = {
  formData: PredictionFormData
  updateFormData: (updates: Partial<PredictionFormData>) => void
}

export const StepPrediction = ({ formData, updateFormData }: Props) => {
  const t = useTranslations('wizard')
  const { ai } = useCapabilities()
  const [isSuggesting, setIsSuggesting] = useState(false)
  const lastSuggestedClaim = useRef('')

  const claimLength = formData.claimText?.length || 0
  const detailsLength = formData.detailsText || '' ? String(formData.detailsText).length : 0
  const isClaimTooShort = claimLength > 0 && claimLength < 10

  // Auto-suggest tags when user types a meaningful claim
  useEffect(() => {
    const claim = formData.claimText?.trim() || ''

    // Trigger if claim is substantial (e.g. > 20 chars) and has changed since last suggestion.
    // AI tag-suggestion is off by default on self-host.
    if (ai && claim.length >= 20 && claim !== lastSuggestedClaim.current && !isSuggesting) {
      const timer = setTimeout(async () => {
        setIsSuggesting(true)
        lastSuggestedClaim.current = claim
        try {
          const res = await fetch('/api/ai/suggest-tags', {
            method: 'POST',
            body: JSON.stringify({ claim, details: formData.detailsText })
          })
          if (res.ok) {
            const data = await res.json()
            if (data.tags?.length > 0) {
              // Combine existing and new tags, unikified, max 5
              const currentTags = formData.tags || []
              const combined = Array.from(new Set([...currentTags, ...data.tags])).slice(0, 5)
              updateFormData({ tags: combined })
            }
          }
        } catch (error) {
          log.warn({ err: error }, 'Failed to auto-suggest tags')
        } finally {
          setIsSuggesting(false)
        }
      }, 1500) // 1.5s debounce

      return () => clearTimeout(timer)
    }
  }, [ai, formData.claimText, formData.detailsText, formData.tags, updateFormData, isSuggesting])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          {t('writeForecast')}
        </h2>
        <p className="text-gray-500">
          {t('writeForecastDesc')}
        </p>
      </div>

      {/* Claim Text */}
      <div>
        <label htmlFor="claimText" className="block text-sm font-medium text-text-secondary mb-2">
          {t('claimLabel')}
        </label>
        <textarea
          id="claimText"
          value={formData.claimText}
          onChange={(e) => updateFormData({ claimText: e.target.value })}
          placeholder={t('claimPlaceholder')}
          rows={3}
          maxLength={500}
          className={`w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border ${isClaimTooShort ? 'border-amber-500' : 'border-navy-600'
            } focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent resize-none`}
        />
        <div className="flex justify-between mt-1">
          {isClaimTooShort && (
            <p className="text-sm text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {t('claimTooShort')}
            </p>
          )}
          <p className="text-sm text-gray-400 ml-auto">{claimLength}/500</p>
        </div>
      </div>

      {/* Details Text */}
      <div>
        <label htmlFor="detailsText" className="block text-sm font-medium text-text-secondary mb-2">
          {t('detailsLabel')}
          <span className="text-gray-400 font-normal ml-2">{t('optional')}</span>
        </label>
        <textarea
          id="detailsText"
          value={formData.detailsText || ''}
          onChange={(e) => updateFormData({ detailsText: e.target.value })}
          placeholder={t('detailsPlaceholder')}
          rows={4}
          maxLength={5000}
          className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent resize-none"
        />
        <p className="text-sm text-gray-400 mt-1 text-right">{detailsLength}/5000</p>
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-text-secondary flex items-center gap-2">
            {t('tagsLabel')}
            <span className="text-gray-400 font-normal ml-1">{t('tagsOptional')}</span>
            {isSuggesting && (
              <span className="flex items-center gap-1.5 text-blue-600 text-xs font-bold animate-pulse ml-2 px-2 py-0.5 bg-cobalt/10 rounded-full border border-cobalt/20">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('aiCategorizing')}
              </span>
            )}
          </label>
        </div>
        <TagSelector
          selectedTags={formData.tags || []}
          onChange={(tags) => updateFormData({ tags })}
          placeholder={t('tagsPlaceholder')}
        />
        <p className="text-xs text-gray-400 mt-2 italic">
          {t('tagsTip')}
        </p>
      </div>

      {/* Similar forecasts warning */}
      <SimilarForecastsWarning claimText={formData.claimText} tags={formData.tags || []} />

      {/* Tips */}
      <div className="p-4 bg-amber-900/20 border border-amber-700/40 rounded-lg">
        <h3 className="font-medium text-amber-800 mb-2">{t('tipsTitle')}</h3>
        <ul className="text-sm text-amber-400 space-y-1">
          <li>• {t('tip1')}</li>
          <li>• {t('tip2')}</li>
          <li>• {t('tip3')}</li>
          <li>• {t('tip4')}</li>
        </ul>
      </div>
    </div>
  )
}

