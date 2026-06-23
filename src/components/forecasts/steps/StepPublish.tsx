'use client'

import {
  Newspaper,
  FileText,
  Target,
  Calendar,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { PredictionFormData } from '../ForecastWizard'

type Props = {
  formData: PredictionFormData
  updateFormData: (updates: Partial<PredictionFormData>) => void
}

export const StepPublish = ({ formData, updateFormData }: Props) => {
  const t = useTranslations('wizard')

  const formatDate = (dateStr: string) => {
    if (!dateStr) return t('notSet')
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const getOutcomeDescription = () => {
    switch (formData.outcomeType) {
      case 'BINARY':
        return t('outcomeBinary')
      case 'MULTIPLE_CHOICE':
        return t('outcomeMultiple', { count: formData.outcomeOptions?.length || 0 })
      case 'NUMERIC_THRESHOLD':
        if (formData.numericThreshold) {
          const { metric, direction, threshold } = formData.numericThreshold
          return `${metric} ${direction} ${threshold}`
        }
        return t('outcomeNumericFallback')
      default:
        return t('notSet')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          {t('reviewTitle')}
        </h2>
        <p className="text-gray-500">
          {t('reviewDesc')}
        </p>
      </div>

      {/* Summary Card */}
      <div className="border border-navy-600 rounded-xl overflow-hidden">
        {/* News Anchor */}
        {formData.newsAnchorTitle && (
          <div className="p-4 bg-navy-800 border-b border-navy-600">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Newspaper className="w-4 h-4" />
              {t('newsAnchorLabel')}
            </div>
            <p className="font-medium text-white">{formData.newsAnchorTitle}</p>
            {formData.newsAnchorUrl && (
              <a
                href={formData.newsAnchorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                {new URL(formData.newsAnchorUrl).hostname}
              </a>
            )}
          </div>
        )}

        {/* Prediction */}
        <div className="p-4 border-b border-navy-600">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <FileText className="w-4 h-4" />
            {t('predictionLabel')}
          </div>
          <p className="font-medium text-white text-lg">{formData.claimText || t('noClaimSet')}</p>
          {formData.detailsText && (
            <p className="text-gray-300 mt-2">{formData.detailsText}</p>
          )}
          {formData.tags && formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {formData.tags.map((tag, i) => (
                <span key={i} className="px-2 py-1 bg-cobalt/10 text-cobalt-light text-xs rounded-full border border-cobalt/20">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Outcome */}
        <div className="p-4 border-b border-navy-600">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Target className="w-4 h-4" />
            {t('reviewOutcomeType')}
          </div>
          <p className="font-medium text-white">{getOutcomeDescription()}</p>

          {formData.outcomeType === 'MULTIPLE_CHOICE' && formData.outcomeOptions && (
            <ul className="mt-2 space-y-1">
              {formData.outcomeOptions.map((option, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-navy-600 flex items-center justify-center text-xs">
                    {index + 1}
                  </span>
                  {option}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Resolution */}
        <div className="p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Calendar className="w-4 h-4" />
            {t('reviewResolutionDate')}
          </div>
          <p className="font-medium text-white">{formatDate(formData.resolveByDatetime)}</p>
          {formData.resolutionRules && (
            <p className="text-sm text-gray-300 mt-2">{formData.resolutionRules}</p>
          )}
        </div>
      </div>

      {/* Visibility Toggle */}
      <div className="border border-navy-600 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-white">
              {formData.isPublic ? t('public') : t('unlisted')}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {formData.isPublic ? t('publicDesc') : t('unlistedDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => updateFormData({ isPublic: !formData.isPublic })}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              formData.isPublic
                ? 'bg-teal/10 text-teal border-green-200 hover:bg-green-100'
                : 'bg-navy-800 text-gray-600 border-navy-600 hover:bg-navy-700'
            }`}
          >
            {formData.isPublic ? (
              <><Eye className="w-4 h-4" /> {t('public')}</>
            ) : (
              <><EyeOff className="w-4 h-4" /> {t('unlisted')}</>
            )}
          </button>
        </div>
      </div>

      {/* Publish Checklist */}
      <div className="p-4 bg-teal/10 border border-green-200 rounded-lg">
        <h3 className="font-medium text-green-800 mb-3">{t('readyToPublish')}</h3>
        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-sm text-teal">
            <Check className="w-4 h-4" />
            {formData.isPublic ? t('checklistPublic') : t('checklistUnlisted')}
          </li>
          <li className="flex items-center gap-2 text-sm text-teal">
            <Check className="w-4 h-4" />
            {t('checklistAgree')}
          </li>
          <li className="flex items-center gap-2 text-sm text-teal">
            <Check className="w-4 h-4" />
            {t('checklistResolved', { date: formatDate(formData.resolveByDatetime) })}
          </li>
        </ul>
      </div>

      {/* Draft Notice */}
      <p className="text-sm text-gray-500 text-center">
        {t.rich('draftNotice', { b: (chunks) => <span className="font-medium">{chunks}</span> })}
      </p>
    </div>
  )
}

