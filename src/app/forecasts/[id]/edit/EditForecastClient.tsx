'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Save, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  ChevronLeft,
  Calendar,
  Lock,
  Unlock,
  Info,
  Plus,
  Trash2,
  LayoutList,
} from 'lucide-react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/Button'
import { PrimaryLink } from '@/components/ui/PrimaryLink'
import { createClientLogger } from '@/lib/client-logger'
import { toLocalDatetimeInput } from '@/lib/utils/date'

const log = createClientLogger('EditForecast')

interface PredictionOption {
  id: string
  text: string
  displayOrder: number
}

interface Prediction {
  id: string
  slug: string | null
  claimText: string
  detailsText: string | null
  resolutionRules: string | null
  resolveByDatetime: string
  status: string
  isPublic: boolean
  userId: string
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'NUMERIC_THRESHOLD'
  options: PredictionOption[]
  originalLanguage?: string | null
  original?: { claimText?: string; detailsText?: string; resolutionRules?: string }
}

// RTL scripts whose edit fields need dir="rtl".
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur'])

interface EditForecastClientProps {
  id: string
}

export default function EditForecastClient({ id }: EditForecastClientProps) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('Forecasts')
  const f = useTranslations('forecast')
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Non-null when the author edits in the forecast's original (non-English) language;
  // the English canonical is then re-derived server-side on save.
  const [editLang, setEditLang] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    claimText: '',
    detailsText: '',
    resolutionRules: '',
    resolveByDatetime: '',
    isPublic: true,
    options: [] as string[],
  })

  useEffect(() => {
    async function fetchPrediction() {
      try {
        const response = await fetch(`/api/forecasts/${id}`)
        if (!response.ok) {
          if (response.status === 404) throw new Error(t('notFound'))
          if (response.status === 403) throw new Error('You do not have permission to edit this forecast')
          throw new Error('Failed to load forecast')
        }
        const data = await response.json()
        setPrediction(data)

        // For a non-English-authored forecast, edit the author's ORIGINAL-language text
        // (claimText/etc. are English-canonical). English is re-derived on save.
        const inOriginal = data.originalLanguage && data.originalLanguage !== 'en'
        setEditLang(inOriginal ? data.originalLanguage : null)
        const src = inOriginal && data.original ? data.original : data

        // Initialize form
        const resolveDate = new Date(data.resolveByDatetime)
        setFormData({
          claimText: src.claimText || data.claimText || '',
          detailsText: src.detailsText ?? data.detailsText ?? '',
          resolutionRules: src.resolutionRules ?? data.resolutionRules ?? '',
          resolveByDatetime: toLocalDatetimeInput(resolveDate),
          isPublic: data.isPublic !== false,
          options: data.options?.map((o: PredictionOption) => o.text) || [],
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setIsLoading(false)
      }
    }

    fetchPrediction()
  }, [id, t])

  const handleChange = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setSaveSuccess(false)
    setSaveError(null)
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...formData.options]
    newOptions[index] = value
    handleChange('options', newOptions)
  }

  const addOption = () => {
    if (formData.options.length < 10) {
      handleChange('options', [...formData.options, ''])
    }
  }

  const removeOption = (index: number) => {
    if (formData.options.length > 2) {
      const newOptions = formData.options.filter((_, i) => i !== index)
      handleChange('options', newOptions)
    }
  }

  const handleSave = async () => {
    if (!prediction) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const { options, ...rest } = formData
      // Only send options if MULTIPLE_CHOICE
      const payload = {
        ...rest,
        resolveByDatetime: new Date(formData.resolveByDatetime).toISOString(),
        ...(prediction.outcomeType === 'MULTIPLE_CHOICE' ? { options } : {}),
      }

      const response = await fetch(`/api/forecasts/${prediction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData?.error || `${t('saveError')} (${response.status})`)
      }

      const updated = await response.json()
      setPrediction(updated)
      setSaveSuccess(true)

      // Update form with saved values. When editing in the original language, the
      // response carries the (re-derived) ENGLISH text — keep the author's original
      // wording in the fields instead of flipping them to English.
      const resolveDate = new Date(updated.resolveByDatetime)
      setFormData(prev => ({
        claimText: editLang ? prev.claimText : (updated.claimText || ''),
        detailsText: editLang ? prev.detailsText : (updated.detailsText || ''),
        resolutionRules: editLang ? prev.resolutionRules : (updated.resolutionRules || ''),
        resolveByDatetime: toLocalDatetimeInput(resolveDate),
        isPublic: updated.isPublic !== false,
        options: updated.options?.map((o: PredictionOption) => o.text) || [],
      }))
    } catch (err) {
      log.error({ err }, 'Error saving forecast')
      setSaveError(err instanceof Error ? err.message : t('saveError'))
    } finally {
      setIsSaving(false)
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
            {error || t('notFound')}
          </h2>
          <PrimaryLink href="/">
            {t('backToFeed')}
          </PrimaryLink>
        </div>
      </div>
    )
  }

  const isDraft = prediction.status === 'DRAFT'
  const isMultipleChoice = prediction.outcomeType === 'MULTIPLE_CHOICE'
  const textDir = editLang && RTL_LANGS.has(editLang) ? 'rtl' : undefined

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Back Link */}
      <Link
        href={`/forecasts/${prediction.slug || prediction.id}`}
        className="inline-flex items-center gap-1 text-gray-500 hover:text-text-secondary mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('backToForecast')}
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          {t('title')}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Status: <span className="font-medium capitalize">{f(prediction.status.toLowerCase()).toLowerCase()}</span>
        </p>
      </div>

      {/* Original-language edit notice */}
      {editLang && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-blue-500/30 bg-cobalt/10 px-4 py-3 text-sm text-blue-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {t('editingInOriginal', {
              language: new Intl.DisplayNames([locale], { type: 'language' }).of(editLang) || editLang,
            })}
          </span>
        </div>
      )}

      {/* Form */}
      <div className="space-y-6">
        {/* Claim Text */}
        <div>
          <label htmlFor="claimText" className="block text-sm font-medium text-text-secondary mb-2">
            {t('claimLabel')} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="claimText"
            dir={textDir}
            value={formData.claimText}
            onChange={(e) => handleChange('claimText', e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full px-4 py-3 border border-navy-600 rounded-xl text-sm bg-navy-800 text-white placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="What is the prediction?"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">{formData.claimText.length}/500</p>
        </div>

        {/* Options Editor for Multiple Choice */}
        {isMultipleChoice && (
          <div className="bg-navy-900/30 border border-navy-600 rounded-2xl p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <LayoutList className="w-5 h-5 text-blue-500" />
              <h3 className="font-bold text-white">Options</h3>
            </div>
            
            <div className="space-y-3">
              {formData.options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                    className="flex-1 px-4 py-2 bg-navy-800 text-white border border-navy-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={500}
                  />
                  {formData.options.length > 2 && (
                    <button
                      onClick={() => removeOption(index)}
                      className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                      title="Remove option"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
              
              {formData.options.length < 10 && (
                <button
                  onClick={addOption}
                  className="flex items-center gap-2 text-sm font-medium text-blue-500 hover:text-blue-400 transition-colors mt-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Option
                </button>
              )}
            </div>
          </div>
        )}

        {/* Details Text */}
        <div>
          <label htmlFor="detailsText" className="block text-sm font-medium text-text-secondary mb-2">
            {t('detailsLabel')}
          </label>
          <textarea
            id="detailsText"
            dir={textDir}
            value={formData.detailsText}
            onChange={(e) => handleChange('detailsText', e.target.value)}
            rows={5}
            className="w-full px-4 py-3 border border-navy-600 rounded-xl text-sm bg-navy-800 text-white placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Add more details, links, or context..."
          />
        </div>

        {/* Resolution Rules */}
        <div>
          <label htmlFor="resolutionRules" className="block text-sm font-medium text-text-secondary mb-2">
            {t('resolutionRulesLabel')}
          </label>
          <textarea
            id="resolutionRules"
            dir={textDir}
            value={formData.resolutionRules}
            onChange={(e) => handleChange('resolutionRules', e.target.value)}
            rows={3}
            className="w-full px-4 py-3 border border-navy-600 rounded-xl text-sm bg-navy-800 text-white placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="How will this be resolved? Which sources will be used?"
          />
        </div>

        {/* Resolve By Date */}
        <div>
          <label htmlFor="resolveByDatetime" className="block text-sm font-medium text-text-secondary mb-2">
            {t('resolveByLabel')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="datetime-local"
              id="resolveByDatetime"
              value={formData.resolveByDatetime}
              onChange={(e) => handleChange('resolveByDatetime', e.target.value)}
              className="w-full pl-11 pr-4 py-3 border border-navy-600 rounded-xl text-sm bg-navy-800 text-white placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
            <Info className="w-3 h-3" />
            Predictions are usually resolved within 24 hours of this date.
          </p>
        </div>

        {/* Visibility */}
        <div className="pt-2">
          <label className="block text-sm font-medium text-text-secondary mb-3">
            {t('visibilityLabel')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => handleChange('isPublic', true)}
              className={`flex items-center gap-3 p-4 border rounded-xl transition-all ${
                formData.isPublic 
                  ? 'border-blue-500 bg-cobalt/10 ring-1 ring-blue-500' 
                  : 'border-navy-600 bg-navy-700 hover:border-gray-300'
              }`}
            >
              <div className={`p-2 rounded-lg ${formData.isPublic ? 'bg-blue-100 text-blue-600' : 'bg-navy-700 text-gray-500'}`}>
                <Unlock className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold">{t('public')}</div>
                <div className="text-xs text-gray-500">{t('publicDesc')}</div>
              </div>
            </button>

            <button
              onClick={() => handleChange('isPublic', false)}
              className={`flex items-center gap-3 p-4 border rounded-xl transition-all ${
                !formData.isPublic 
                  ? 'border-blue-500 bg-cobalt/10 ring-1 ring-blue-500' 
                  : 'border-navy-600 bg-navy-700 hover:border-gray-300'
              }`}
            >
              <div className={`p-2 rounded-lg ${!formData.isPublic ? 'bg-blue-100 text-blue-600' : 'bg-navy-700 text-gray-500'}`}>
                <Lock className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold">{t('unlisted')}</div>
                <div className="text-xs text-gray-500">{t('unlistedDesc')}</div>
              </div>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-6 border-t border-navy-600 flex flex-col sm:flex-row gap-3">
          <Button
            onClick={handleSave}
            loading={isSaving}
            disabled={!formData.claimText || !formData.resolveByDatetime}
            className="sm:flex-1"
            leftIcon={<Save className="w-4 h-4" />}
          >
            {t('saveChanges')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push(`/forecasts/${prediction.slug || prediction.id}`)}
            className="sm:flex-none"
          >
            {t('cancel')}
          </Button>
        </div>

        {/* Status Messages */}
        {saveSuccess && (
          <div className="bg-teal/10 border border-teal/20 text-teal px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">{t('saveSuccess')}</span>
          </div>
        )}

        {saveError && (
          <div className="bg-red-900/20 border border-red-800/40 text-red-400 px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">{saveError}</span>
          </div>
        )}
      </div>
    </div>
  )
}

