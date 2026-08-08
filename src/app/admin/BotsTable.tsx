'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Play, FlaskConical, Power, ChevronDown, ChevronUp, Plus, Pencil, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CreateBotForm } from './_bots/CreateBotForm'
import { EditBotModal } from './_bots/EditBotModal'
import { formatInterval, relativeTime, actionBadge } from './_bots/helpers'
import type { Bot, BotLog, BotRunSummary } from './_bots/types'
import { SubmitProgress, type ProgressStep } from '@/components/forecasts/SubmitProgress'
import { getEstimate, recordDuration, type TimingKey } from '@/lib/forecast-timing'

// "Run now" progress phases (daatan#1139), mirroring runner.ts's RunMetrics
// stages: RSS/Oracle fetch, hot-topic detection, dedup+LLM generation, stake.
const BOT_RUN_STEP_KEYS = ['fetch', 'detect', 'generate', 'stake'] as const
type BotRunStepKey = typeof BOT_RUN_STEP_KEYS[number]
const BOT_RUN_TIMING_KEY: Record<BotRunStepKey, TimingKey> = {
  fetch: 'bot-fetch',
  detect: 'bot-detect',
  generate: 'bot-generate',
  stake: 'bot-stake',
}

export default function BotsTable() {
  const t = useTranslations('admin')
  const [bots, setBots] = useState<Bot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [runningBots, setRunningBots] = useState<Set<string>>(new Set())
  const [runSteps, setRunSteps] = useState<Record<string, ProgressStep[]>>({})
  const runTimers = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({})
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<Record<string, BotLog[]>>({})
  const [loadingLogs, setLoadingLogs] = useState<Set<string>>(new Set())
  const [editingBot, setEditingBot] = useState<Bot | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<BotRunSummary | null>(null)
  const [allTags, setAllTags] = useState<{ id: string; name: string; slug: string }[]>([])

  const botRunSteps = useCallback((activeIndex: number): ProgressStep[] => {
    const labels: Record<BotRunStepKey, string> = {
      fetch: t('runStepFetch'),
      detect: t('runStepDetect'),
      generate: t('runStepGenerate'),
      stake: t('runStepStake'),
    }
    return BOT_RUN_STEP_KEYS.map((key, i) => ({
      key,
      label: labels[key],
      state: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
    }))
  }, [t])

  const activeEstimateFor = (botId: string): number => {
    const active = runSteps[botId]?.find((s) => s.state === 'active')
    if (!active) return 0
    return getEstimate(BOT_RUN_TIMING_KEY[active.key as BotRunStepKey])
  }

  const fetchBots = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/bots')
      if (res.ok) {
        const data = await res.json()
        setBots(data.bots)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags')
      if (res.ok) {
        const data = await res.json()
        setAllTags(data.tags)
      }
    } catch { }
  }, [])

  useEffect(() => {
    fetchBots()
    fetchTags()
  }, [fetchBots, fetchTags])

  const flash = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 3000)
  }

  const runBot = async (botId: string, dryRun: boolean) => {
    setRunningBots((s) => new Set(s).add(botId))
    setRunResult(null)

    // Calibrated step-progress feedback (daatan#1139): the run route stays a
    // plain blocking request, so step transitions are client-scheduled
    // setTimeouts against per-device estimates — no server push involved.
    const estimates = BOT_RUN_STEP_KEYS.map((key) => getEstimate(BOT_RUN_TIMING_KEY[key]))
    setRunSteps((r) => ({ ...r, [botId]: botRunSteps(0) }))
    const timers: ReturnType<typeof setTimeout>[] = []
    let cumulative = 0
    for (let i = 1; i < BOT_RUN_STEP_KEYS.length; i++) {
      cumulative += estimates[i - 1]
      timers.push(setTimeout(() => {
        setRunSteps((r) => ({ ...r, [botId]: botRunSteps(i) }))
      }, cumulative))
    }
    runTimers.current[botId] = timers

    const runStart = performance.now()
    try {
      const res = await fetch(`/api/admin/bots/${botId}/run${dryRun ? '?dry=true' : ''}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setRunResult(data.summary)
        const s = data.summary
        flash(
          dryRun
            ? t('dryRunComplete', { simulated: s.forecastsCreated, skipped: s.skipped, errors: s.errors })
            : t('runComplete', { forecasts: s.forecastsCreated, votes: s.votes, errors: s.errors }),
        )
        fetchBots()
        if (expandedLogs.has(botId)) fetchLogs(botId)
      } else {
        flash(t('errorPrefix', { msg: data.details?.[0]?.message ?? data.error }))
      }
    } catch {
      flash(t('requestFailed'))
    } finally {
      (runTimers.current[botId] ?? []).forEach(clearTimeout)
      delete runTimers.current[botId]
      setRunSteps((r) => { const n = { ...r }; delete n[botId]; return n })
      setRunningBots((s) => { const n = new Set(s); n.delete(botId); return n })

      // No per-phase breakdown comes back from the (still blocking) run
      // route, so split the observed total across the phases proportional
      // to their current estimates — self-correcting as each phase's share
      // of the total drifts toward reality over repeated runs.
      const totalMs = performance.now() - runStart
      const sumEstimates = estimates.reduce((a, b) => a + b, 0)
      BOT_RUN_STEP_KEYS.forEach((key, i) => {
        const weight = sumEstimates > 0 ? estimates[i] / sumEstimates : 1 / estimates.length
        recordDuration(BOT_RUN_TIMING_KEY[key], totalMs * weight)
      })
    }
  }

  const toggleActive = async (bot: Bot) => {
    const res = await fetch(`/api/admin/bots/${bot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !bot.isActive }),
    })
    if (res.ok) {
      setBots((bs) => bs.map((b) => b.id === bot.id ? { ...b, isActive: !b.isActive } : b))
    }
  }

  const fetchLogs = async (botId: string) => {
    setLoadingLogs((s) => new Set(s).add(botId))
    try {
      const res = await fetch(`/api/admin/bots/${botId}/logs?limit=10`)
      if (res.ok) {
        const data = await res.json()
        setLogs((l) => ({ ...l, [botId]: data.logs }))
      }
    } finally {
      setLoadingLogs((s) => { const n = new Set(s); n.delete(botId); return n })
    }
  }

  const toggleLogs = (botId: string) => {
    setExpandedLogs((s) => {
      const n = new Set(s)
      if (n.has(botId)) {
        n.delete(botId)
      } else {
        n.add(botId)
        fetchLogs(botId)
      }
      return n
    })
  }

  const saveBot = async (botId: string, updates: Partial<Bot>) => {
    const res = await fetch(`/api/admin/bots/${botId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      fetchBots()
      setEditingBot(null)
      flash(t('botUpdated'))
    } else {
      const data = await res.json()
      flash(t('errorPrefix', { msg: data.error }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-mist">{t('botsTitle', { count: bots.length })}</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t('newBot')}
        </button>
      </div>

      {actionMsg && (
        <div className="mb-4 p-3 bg-cobalt/10 border border-cobalt/30 rounded-lg text-sm text-cobalt-light">
          {actionMsg}
        </div>
      )}

      {showCreateForm && (
        <CreateBotForm
          onCreated={() => { setShowCreateForm(false); fetchBots() }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {editingBot && (
        <EditBotModal
          bot={editingBot}
          allTags={allTags}
          onSave={(updates) => saveBot(editingBot.id, updates)}
          onClose={() => setEditingBot(null)}
        />
      )}

      {runResult && (
        <div className="mb-6 border-2 border-cobalt/30 bg-cobalt/10 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-blue-600 px-4 py-2 flex justify-between items-center">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">{t('runSummary', { name: runResult.botName })}</h3>
            <button onClick={() => setRunResult(null)} aria-label="Dismiss" className="text-blue-100 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <Stat label={t('statCreated')} value={runResult.forecastsCreated} color="text-teal" />
              <Stat label={t('statVotes')} value={runResult.votes} color="text-cobalt-light" />
              <Stat label={t('statSkipped')} value={runResult.skipped} color="text-gray-400" />
              <Stat label={t('statErrors')} value={runResult.errors} color="text-red-400" />
            </div>

            {runResult.hotTopics && runResult.hotTopics.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase">{t('detectionResults', { count: runResult.hotTopics.length })}</p>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {runResult.hotTopics.map((topic, i) => (
                    <div key={i} className="bg-navy-700 border rounded-lg p-3 text-sm shadow-sm group hover:border-blue-300 transition-colors">
                      <div className="font-semibold text-white group-hover:text-cobalt-light">{topic.title}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{t('appearsInSources', { count: topic.sourceCount })}</div>
                      <div className="mt-2 space-y-1">
                        {topic.items.slice(0, 3).map((item, j) => (
                          <a key={j} href={item.url} target="_blank" rel="noopener noreferrer"
                            className="block text-xs text-blue-600 hover:underline truncate">
                            • [{item.source}] {item.title}
                          </a>
                        ))}
                        {topic.items.length > 3 && (
                          <div className="text-[10px] text-gray-400 pl-3">{t('andMore', { count: topic.items.length - 3 })}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-4 text-sm text-gray-500 italic border-b border-dashed pb-4">
                  {t('noHotTopics')}
                </div>
                {runResult.fetchedCount !== undefined && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase">
                      {t('debugHeadlines', { count: runResult.fetchedCount })}
                    </p>
                    <div className="bg-navy-700 border rounded-lg p-3 text-xs text-gray-300 space-y-1 overflow-y-auto max-h-40">
                      {(runResult.sampleItems ?? []).map((title, i) => (
                        <div key={i} className="truncate">• {title}</div>
                      ))}
                      {runResult.fetchedCount > (runResult.sampleItems?.length ?? 0) && (
                        <div className="text-[10px] text-gray-400 italic">{t('andMore', { count: runResult.fetchedCount - (runResult.sampleItems?.length ?? 0) })}</div>
                      )}
                      {runResult.fetchedCount === 0 && (
                        <div className="text-red-500">{t('noItemsFetched')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {bots.map((bot) => {
          const isRunning = runningBots.has(bot.id)
          const logsExpanded = expandedLogs.has(bot.id)
          const botLogs = logs[bot.id] ?? []
          const logsLoading = loadingLogs.has(bot.id)

          return (
            <div key={bot.id} className="border rounded-lg shadow-sm bg-navy-700 overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white">{bot.user.name}</span>
                      <span className="text-xs font-mono text-gray-500">@{bot.user.username}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bot.isActive ? 'bg-green-100 text-teal' : 'bg-navy-700 text-gray-500'}`}>
                        {bot.isActive ? t('botActive') : t('botDisabled')}
                      </span>
                      {bot.autoApprove && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                          {t('botAutoApprove')}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-300">
                      <div>
                        <span className="text-gray-400">{t('botInterval')}</span>
                        <div className="font-medium">{formatInterval(bot.intervalMinutes)}</div>
                      </div>
                      <div>
                        <span className="text-gray-400">{t('botToday')}</span>
                        <div className="font-medium">
                          {bot.forecastsToday}/{bot.maxForecastsPerDay} forecasts · {bot.votesToday}/{bot.maxVotesPerDay} votes
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-400">{t('botLastRun')}</span>
                        <div className="font-medium">{bot.lastRunAt ? relativeTime(bot.lastRunAt) : t('botNever')}</div>
                      </div>
                      <div>
                        <span className="text-gray-400">{t('botNextRun')}</span>
                        <div className="font-medium">{bot.nextRunAt ? relativeTime(bot.nextRunAt) : '—'}</div>
                      </div>
                    </div>

                    <div className="mt-1 text-xs text-gray-500">
                      {t('botSources', { count: bot.newsSources.length, model: bot.modelPreference })}
                    </div>

                    {bot.lastLog?.error && (
                      <div className="mt-1 text-xs text-red-600">{t('botLastError', { error: bot.lastLog.error.slice(0, 100) })}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditingBot(bot)} title={t('editConfig')}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-cobalt/10 rounded transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => runBot(bot.id, true)} disabled={isRunning} title={t('testDryRun')}
                      className="flex items-center gap-1 text-xs px-2 py-1.5 border border-amber-300 text-amber-400 bg-amber-900/20 hover:bg-amber-100 rounded transition-colors disabled:opacity-50">
                      {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
                      {t('test')}
                    </button>
                    <button onClick={() => runBot(bot.id, false)} disabled={isRunning} title={t('runNow')}
                      className="flex items-center gap-1 text-xs px-2 py-1.5 border border-green-300 text-teal bg-teal/10 hover:bg-green-100 rounded transition-colors disabled:opacity-50">
                      {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      {t('run')}
                    </button>
                    <button onClick={() => toggleActive(bot)} title={bot.isActive ? t('disable') : t('enable')}
                      className={`p-1.5 rounded transition-colors ${bot.isActive ? 'text-green-600 hover:bg-red-900/20 hover:text-red-600' : 'text-gray-400 hover:bg-teal/10 hover:text-green-600'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isRunning && runSteps[bot.id] && (
                  <SubmitProgress steps={runSteps[bot.id]} activeEstimateMs={activeEstimateFor(bot.id)} />
                )}
              </div>

              <button onClick={() => toggleLogs(bot.id)}
                className="w-full flex items-center justify-between px-4 py-2 bg-navy-800 border-t text-xs text-gray-500 hover:bg-navy-700 transition-colors">
                <span>{t('runLog')}</span>
                {logsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {logsExpanded && (
                <div className="border-t">
                  {logsLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    </div>
                  ) : botLogs.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-400">{t('noLogEntries')}</div>
                  ) : (
                    <div className="divide-y">
                      {botLogs.map((log) => (
                        <div key={log.id} className="px-4 py-3">
                          <div className="flex items-center gap-2 text-xs">
                            <span className={`font-medium px-1.5 py-0.5 rounded ${actionBadge(log.action)}`}>
                              {log.isDryRun ? '(dry) ' : ''}{log.action}
                            </span>
                            <span className="text-gray-400">{relativeTime(log.runAt)}</span>
                          </div>
                          {log.triggerNews?.title && (
                            <div className="mt-1 text-xs text-gray-300">{t('logNews', { title: log.triggerNews.title })}</div>
                          )}
                          {log.generatedText && (
                            <details className="mt-1">
                              <summary className="text-xs text-blue-600 cursor-pointer">{t('generatedText')}</summary>
                              <pre className="mt-1 text-xs text-text-secondary whitespace-pre-wrap bg-navy-800 p-2 rounded max-h-40 overflow-y-auto">
                                {log.generatedText}
                              </pre>
                            </details>
                          )}
                          {log.error && <div className="mt-1 text-xs text-red-600">{log.error}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {bots.length === 0 && !showCreateForm && (
          <div className="text-center py-12 text-gray-400">
            {t('noBotsYet')}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-navy-700 p-2 rounded-lg border text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400 uppercase font-medium">{label}</div>
    </div>
  )
}
