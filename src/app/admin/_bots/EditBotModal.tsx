'use client'
import { useState, useId } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { STANDARD_TAGS } from '@/lib/constants'
import { slugify } from '@/lib/utils/slugify'
import type { Bot } from './types'

interface Props {
  bot: Bot
  allTags: { id: string; name: string; slug: string }[]
  onSave: (updates: Partial<Bot>) => void
  onClose: () => void
}

export function EditBotModal({ bot, allTags, onSave, onClose }: Props) {
  const t = useTranslations('admin')
  const voteBiasId = useId()
  const [form, setForm] = useState({
    personaPrompt: bot.personaPrompt,
    forecastPrompt: bot.forecastPrompt,
    votePrompt: bot.votePrompt,
    newsSources: (bot.newsSources ?? []).join('\n'),
    intervalMinutes: bot.intervalMinutes,
    maxForecastsPerDay: bot.maxForecastsPerDay,
    maxVotesPerDay: bot.maxVotesPerDay,
    stakeMin: bot.stakeMin,
    stakeMax: bot.stakeMax,
    modelPreference: bot.modelPreference,
    hotnessMinSources: bot.hotnessMinSources,
    hotnessWindowHours: bot.hotnessWindowHours,
    activeHoursStart: bot.activeHoursStart,
    activeHoursEnd: bot.activeHoursEnd,
    tagFilter: bot.tagFilter ?? [],
    voteBias: bot.voteBias ?? 50,
    canCreateForecasts: bot.canCreateForecasts ?? true,
    canVote: bot.canVote ?? true,
    autoApprove: bot.autoApprove ?? false,
    requireApprovalForForecasts: bot.requireApprovalForForecasts ?? false,
    enableSentimentExtraction: bot.enableSentimentExtraction ?? false,
    enableRejectionTracking: bot.enableRejectionTracking ?? false,
    showMetadataOnForecast: bot.showMetadataOnForecast ?? false,
    maxForecastsPerHour: bot.maxForecastsPerHour ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const sources = form.newsSources
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const updates: Partial<Bot> = {
      personaPrompt: form.personaPrompt,
      forecastPrompt: form.forecastPrompt,
      votePrompt: form.votePrompt,
      newsSources: sources,
      intervalMinutes: form.intervalMinutes,
      maxForecastsPerDay: form.maxForecastsPerDay,
      maxVotesPerDay: form.maxVotesPerDay,
      stakeMin: form.stakeMin,
      stakeMax: form.stakeMax,
      modelPreference: form.modelPreference,
      hotnessMinSources: form.hotnessMinSources,
      hotnessWindowHours: form.hotnessWindowHours,
      activeHoursStart: form.activeHoursStart,
      activeHoursEnd: form.activeHoursEnd,
      tagFilter: form.tagFilter,
      voteBias: form.voteBias,
      canCreateForecasts: form.canCreateForecasts,
      canVote: form.canVote,
      autoApprove: form.autoApprove,
      requireApprovalForForecasts: form.requireApprovalForForecasts,
      enableSentimentExtraction: form.enableSentimentExtraction,
      enableRejectionTracking: form.enableRejectionTracking,
      showMetadataOnForecast: form.showMetadataOnForecast,
      maxForecastsPerHour: form.maxForecastsPerHour,
    }
    onSave(updates)
    setSaving(false)
  }

  const toggleTag = (slug: string) => {
    setForm(prev => {
      const tags = prev.tagFilter.includes(slug)
        ? prev.tagFilter.filter(t => t !== slug)
        : [...prev.tagFilter, slug]
      return { ...prev, tagFilter: tags }
    })
  }

  const suggestions = [
    ...allTags,
    ...STANDARD_TAGS
      .filter(name => !allTags.some(t => t.name.toLowerCase() === name.toLowerCase()))
      .map(name => ({ id: `std-${name}`, name, slug: slugify(name) }))
  ]

  const filteredTags = suggestions.filter(t =>
    t.name.toLowerCase().includes(tagInput.toLowerCase()) ||
    t.slug.toLowerCase().includes(tagInput.toLowerCase())
  ).filter(t => !form.tagFilter.includes(t.slug)).slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-navy-700 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-navy-700 z-10">
          <h3 className="font-semibold text-white">{t('editBotTitle', { name: bot.user.name ?? '' })}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 space-y-4">
          <Field label={t('personaPrompt')} hint={t('personaPromptHint')}>
            <textarea
              value={form.personaPrompt}
              onChange={(e) => setForm({ ...form, personaPrompt: e.target.value })}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </Field>

          <Field label={t('forecastCreationPrompt')} hint={t('forecastCreationPromptHint')}>
            <textarea
              value={form.forecastPrompt}
              onChange={(e) => setForm({ ...form, forecastPrompt: e.target.value })}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </Field>

          <Field label={t('voteDecisionPrompt')} hint={t('voteDecisionPromptHint')}>
            <textarea
              value={form.votePrompt}
              onChange={(e) => setForm({ ...form, votePrompt: e.target.value })}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </Field>

          <Field label={t('newsSources')} hint={t('newsSourcesHint')}>
            <div className="text-[10px] text-blue-600 mb-1 font-medium">
              {t('newsSourcesTip')}
            </div>
            <textarea
              value={form.newsSources}
              onChange={(e) => setForm({ ...form, newsSources: e.target.value })}
              rows={4}
              placeholder="https://feeds.bbci.co.uk/news/world/rss.xml"
              className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </Field>

          <Field label={t('llmModel')} hint={t('llmModelHint')}>
            <input
              value={form.modelPreference}
              onChange={(e) => setForm({ ...form, modelPreference: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <NumberField label={t('intervalMin')} value={form.intervalMinutes} min={5}
              onChange={(v) => setForm({ ...form, intervalMinutes: v })} />
            <NumberField label={t('maxForecastsDay')} value={form.maxForecastsPerDay} min={0}
              onChange={(v) => setForm({ ...form, maxForecastsPerDay: v })} />
            <NumberField label={t('maxVotesDay')} value={form.maxVotesPerDay} min={0}
              onChange={(v) => setForm({ ...form, maxVotesPerDay: v })} />
            <NumberField label={t('stakeMin')} value={form.stakeMin} min={1}
              onChange={(v) => setForm({ ...form, stakeMin: v })} />
            <NumberField label={t('stakeMax')} value={form.stakeMax} min={1}
              onChange={(v) => setForm({ ...form, stakeMax: v })} />
            <NumberField label={t('minSources')} value={form.hotnessMinSources} min={1}
              onChange={(v) => setForm({ ...form, hotnessMinSources: v })} />
            <NumberField label={t('hotnessWindow')} value={form.hotnessWindowHours} min={1}
              onChange={(v) => setForm({ ...form, hotnessWindowHours: v })} />
            <NumberField label={t('maxForecastsHour')} value={form.maxForecastsPerHour} min={0}
              onChange={(v) => setForm({ ...form, maxForecastsPerHour: v })} />
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-navy-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('actionsBias')}</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.canCreateForecasts}
                  onChange={(e) => setForm({ ...form, canCreateForecasts: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('canCreateForecasts')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.canVote}
                  onChange={(e) => setForm({ ...form, canVote: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('canVote')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.autoApprove}
                  onChange={(e) => setForm({ ...form, autoApprove: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                {t('autoApproveForecasts')}
                <span className="text-xs text-gray-400 font-normal">{t('skipApprovalQueue')}</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 pt-2 border-t border-navy-600">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.requireApprovalForForecasts}
                  onChange={(e) => setForm({ ...form, requireApprovalForForecasts: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('requireApproval')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.enableSentimentExtraction}
                  onChange={(e) => setForm({ ...form, enableSentimentExtraction: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('enableSentiment')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.enableRejectionTracking}
                  onChange={(e) => setForm({ ...form, enableRejectionTracking: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('enableRejection')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.showMetadataOnForecast}
                  onChange={(e) => setForm({ ...form, showMetadataOnForecast: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t('showMetadata')}
              </label>
            </div>
            <div className="max-w-xs">
              <label htmlFor={voteBiasId} className="block text-xs font-medium text-gray-400 mb-1">
                {t('voteBias', { bias: form.voteBias })}
                <span className="ml-2 text-gray-400 font-normal">
                  ({form.voteBias < 40 ? t('leansNo') : form.voteBias > 60 ? t('leansYes') : t('neutral')})
                </span>
              </label>
              <input id={voteBiasId} type="range" min={0} max={100} value={form.voteBias}
                onChange={(e) => setForm({ ...form, voteBias: parseInt(e.target.value) })}
                className="w-full accent-blue-600" />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>{t('biasNo')}</span>
                <span>{t('biasNeutral')}</span>
                <span>{t('biasYes')}</span>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-navy-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('activeWindow')}</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.activeHoursStart == null}
                onChange={(e) => setForm({
                  ...form,
                  activeHoursStart: e.target.checked ? null : 8,
                  activeHoursEnd: e.target.checked ? null : 22,
                })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              {t('alwaysActive')}
            </label>
            {form.activeHoursStart != null && (
              <div className="grid grid-cols-2 gap-4">
                <NumberField label={t('startHour')} value={form.activeHoursStart} min={0} max={23}
                  onChange={(v) => setForm({ ...form, activeHoursStart: v })} />
                <NumberField label={t('endHour')} value={form.activeHoursEnd ?? 22} min={0} max={23}
                  onChange={(v) => setForm({ ...form, activeHoursEnd: v })} />
                <p className="col-span-2 text-xs text-gray-400">
                  {t('overnightHint')}
                </p>
              </div>
            )}
          </div>

          <Field label={t('tagFilter')} hint={t('tagFilterHint')}>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5 min-h-8 p-2 border rounded bg-navy-700">
                {form.tagFilter.map(slug => (
                  <span key={slug} className="inline-flex items-center gap-1 bg-blue-100 text-cobalt-light px-2 py-0.5 rounded text-xs font-medium">
                    {allTags.find(t => t.slug === slug)?.name ?? slug}
                    <button type="button" onClick={() => toggleTag(slug)} aria-label={`Remove ${allTags.find(t => t.slug === slug)?.name ?? slug}`} className="hover:text-blue-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {form.tagFilter.length === 0 && <span className="text-gray-400 text-xs italic">{t('allTagsEnabled')}</span>}
              </div>
              <div className="relative">
                <input type="text" value={tagInput}
                  onChange={(e) => { setTagInput(e.target.value); setShowTagSuggestions(true) }}
                  onFocus={() => setShowTagSuggestions(true)}
                  placeholder={t('searchTags')}
                  aria-label={t('searchTags')}
                  className="w-full border rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (tagInput.trim()) {
                        const slug = tagInput.toLowerCase().replace(/\s+/g, '-')
                        if (!form.tagFilter.includes(slug)) toggleTag(slug)
                        setTagInput('')
                      }
                    }
                  }}
                />
                {showTagSuggestions && tagInput && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-navy-700 border rounded shadow-lg max-h-40 overflow-y-auto">
                    {filteredTags.map(tag => (
                      <button key={tag.id} type="button"
                        onClick={() => { toggleTag(tag.slug); setTagInput(''); setShowTagSuggestions(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-cobalt/10 transition-colors border-b last:border-0">
                        <span className="font-medium">{tag.name}</span>
                        <span className="ml-2 text-[10px] text-gray-400">#{tag.slug}</span>
                      </button>
                    ))}
                    {filteredTags.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-500">
                        {t('noMatchesAddTag', { tag: tagInput })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2 pb-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-navy-800">
              {t('cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  // A plain-text group label, not <label>, because children isn't always a
  // single labelable control (e.g. the tag-filter field wraps chips + an
  // input) — role="group" + aria-labelledby works for either shape.
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} className="block text-sm font-medium text-text-secondary mb-1">{label}</div>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max?: number; onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input id={id} type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
    </div>
  )
}
