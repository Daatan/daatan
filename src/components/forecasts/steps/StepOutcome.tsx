'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  ToggleLeft,
  List,
  TrendingUp,
  Calendar,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react'
import type { PredictionFormData } from '../ForecastWizard'
import { localEndOfDay } from '@/lib/utils/date'

type Props = {
  formData: PredictionFormData
  updateFormData: (updates: Partial<PredictionFormData>) => void
}

const OUTCOME_TYPES = [
  { value: 'BINARY', labelKey: 'typeBinary', icon: ToggleLeft, descKey: 'typeBinaryDesc' },
  { value: 'MULTIPLE_CHOICE', labelKey: 'typeMultiple', icon: List, descKey: 'typeMultipleDesc' },
  { value: 'NUMERIC_THRESHOLD', labelKey: 'typeNumeric', icon: TrendingUp, descKey: 'typeNumericDesc' },
] as const

export const StepOutcome = ({ formData, updateFormData }: Props) => {
  const t = useTranslations('wizard')
  const [options, setOptions] = useState<string[]>(formData.outcomeOptions || ['', ''])
  
  const minDate = new Date().toISOString().split('T')[0]
  const isDateInPast = formData.resolveByDatetime && localEndOfDay(formData.resolveByDatetime) <= new Date()

  // Sync options with form data
  useEffect(() => {
    if (formData.outcomeType === 'MULTIPLE_CHOICE') {
      updateFormData({ outcomeOptions: options.filter(o => o.trim()) })
    }
  }, [options, formData.outcomeType, updateFormData])

  const handleAddOption = () => {
    if (options.length < 10) {
      setOptions([...options, ''])
    }
  }

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          {t('outcomeTitle')}
        </h2>
        <p className="text-gray-500">
          {t('outcomeDesc')}
        </p>
      </div>

      {/* Outcome Type */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-3">
          {t('outcomeTypeLabel')}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OUTCOME_TYPES.map((type) => {
            const Icon = type.icon
            const isSelected = formData.outcomeType === type.value

            return (
              <button
                key={type.value}
                type="button"
                onClick={() => updateFormData({ outcomeType: type.value as PredictionFormData['outcomeType'] })}
                className={`
                  p-4 rounded-lg border-2 text-left transition-colors
                  ${isSelected 
                    ? 'border-blue-500 bg-cobalt/10' 
                    : 'border-navy-600 hover:border-gray-300'
                  }
                `}
              >
                <Icon className={`w-6 h-6 mb-2 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                <div className={`font-medium ${isSelected ? 'text-cobalt-light' : 'text-white'}`}>
                  {t(type.labelKey)}
                </div>
                <div className="text-sm text-gray-500">{t(type.descKey)}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Multiple Choice Options */}
      {formData.outcomeType === 'MULTIPLE_CHOICE' && (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">
            {t('optionsLabel')}
          </label>
          <div className="space-y-2">
            {options.map((option, index) => (
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
                  className="flex-1 px-4 py-2 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
                  maxLength={500}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(index)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label={t('removeOption')}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {options.length < 10 && (
            <button
              type="button"
              onClick={handleAddOption}
              className="mt-3 flex items-center gap-2 text-blue-600 hover:text-cobalt-light transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t('addOption')}
            </button>
          )}
        </div>
      )}

      {/* Numeric Threshold */}
      {formData.outcomeType === 'NUMERIC_THRESHOLD' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="metric" className="block text-sm font-medium text-text-secondary mb-2">
              {t('metricLabel')}
            </label>
            <input
              type="text"
              id="metric"
              value={formData.numericThreshold?.metric || ''}
              onChange={(e) => updateFormData({
                numericThreshold: {
                  ...formData.numericThreshold,
                  metric: e.target.value,
                  threshold: formData.numericThreshold?.threshold || 0,
                  direction: formData.numericThreshold?.direction || 'above',
                },
              })}
              placeholder={t('metricPlaceholder')}
              className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="direction" className="block text-sm font-medium text-text-secondary mb-2">
                {t('directionLabel')}
              </label>
              <select
                id="direction"
                value={formData.numericThreshold?.direction || 'above'}
                onChange={(e) => updateFormData({
                  numericThreshold: {
                    ...formData.numericThreshold,
                    metric: formData.numericThreshold?.metric || '',
                    threshold: formData.numericThreshold?.threshold || 0,
                    direction: e.target.value as 'above' | 'below' | 'exactly',
                  },
                })}
                className="w-full px-4 py-3 rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent bg-navy-700 text-white"
              >
                <option value="above">{t('dirAbove')}</option>
                <option value="below">{t('dirBelow')}</option>
                <option value="exactly">{t('dirExactly')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="threshold" className="block text-sm font-medium text-text-secondary mb-2">
                {t('thresholdLabel')}
              </label>
              <input
                type="number"
                id="threshold"
                value={formData.numericThreshold?.threshold || ''}
                onChange={(e) => updateFormData({
                  numericThreshold: {
                    ...formData.numericThreshold,
                    metric: formData.numericThreshold?.metric || '',
                    threshold: parseFloat(e.target.value) || 0,
                    direction: formData.numericThreshold?.direction || 'above',
                  },
                })}
                placeholder="100000"
                className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
              />
            </div>
          </div>
        </div>
      )}

      {/* Resolution Date */}
      <div>
        <label htmlFor="resolveByDatetime" className="block text-sm font-medium text-text-secondary mb-2">
          {t('resolutionDateLabel')}
        </label>
        <div className="relative">
          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="date"
            id="resolveByDatetime"
            value={formData.resolveByDatetime}
            onChange={(e) => updateFormData({ resolveByDatetime: e.target.value })}
            min={minDate}
            className={`w-full pl-12 pr-4 py-3 bg-navy-800 text-white rounded-lg border ${
              isDateInPast ? 'border-red-500' : 'border-navy-600'
            } focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent`}
          />
        </div>
        {isDateInPast && (
          <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {t('dateInPast')}
          </p>
        )}
      </div>

      {/* Resolution Rules */}
      <div>
        <label htmlFor="resolutionRules" className="block text-sm font-medium text-text-secondary mb-2">
          {t('resolutionRulesLabel')} <span className="text-red-400">*</span>
        </label>
        <textarea
          id="resolutionRules"
          value={formData.resolutionRules || ''}
          onChange={(e) => updateFormData({ resolutionRules: e.target.value })}
          placeholder={t('resolutionRulesPlaceholder')}
          rows={3}
          maxLength={2000}
          className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent resize-none"
        />
      </div>
    </div>
  )
}

