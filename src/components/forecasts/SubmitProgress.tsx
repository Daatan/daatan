'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2 } from 'lucide-react'

export type SubmitPhase = 'creating' | 'publishing' | 'done'

interface SubmitProgressProps {
  mode: 'draft' | 'publish'
  phase: SubmitPhase
  createEstimateMs: number
  publishEstimateMs: number
}

type StepState = 'done' | 'active' | 'pending'

/**
 * Inline step progress shown beneath the submit button while a forecast is
 * being created. Estimates are client-side (calibrated via localStorage) — the
 * server does the real work opaquely, so the bar is a calibrated estimate, not
 * a live server feed. Honest about what blocks: "Checking content…" is the
 * moderation LLM call (the real wait); embedding/translation run in the
 * background after the response and are intentionally not shown here.
 */
export function SubmitProgress({ mode, phase, createEstimateMs, publishEstimateMs }: SubmitProgressProps) {
  const t = useTranslations('wizard')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number>(Date.now())

  // Restart the elapsed timer whenever the active phase changes.
  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    if (phase === 'done') return
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100)
    return () => clearInterval(id)
  }, [phase])

  const activeEstimate = phase === 'publishing' ? publishEstimateMs : createEstimateMs
  const overrun = elapsed >= activeEstimate
  const ratio = overrun ? 0.95 : Math.min(elapsed / activeEstimate, 0.95)
  const secondsLeft = Math.max(0, Math.ceil((activeEstimate - elapsed) / 1000))

  const steps: { key: string; label: string; state: StepState }[] = [
    { key: 'check', label: t('checking'), state: phase === 'creating' ? 'active' : 'done' },
    { key: 'save', label: t('saving'), state: phase === 'creating' ? 'pending' : 'done' },
  ]
  if (mode === 'publish') {
    steps.push({
      key: 'publish',
      label: t('publishingStep'),
      state: phase === 'publishing' ? 'active' : phase === 'done' ? 'done' : 'pending',
    })
  }

  return (
    <div className="mt-4 space-y-2" role="status" aria-live="polite">
      {steps.map((step) => (
        <div key={step.key} className="flex items-center gap-3 text-sm">
          <span className="flex-shrink-0 w-4 flex justify-center">
            {step.state === 'done' ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : step.state === 'active' ? (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            ) : (
              <span className="block w-2 h-2 rounded-full bg-navy-500" />
            )}
          </span>
          <span className={step.state === 'pending' ? 'text-navy-400' : 'text-gray-200'}>
            {step.label}
          </span>
          {step.state === 'active' && (
            <span className="ml-auto flex items-center gap-2 text-xs text-navy-300">
              <span className="w-20 h-1.5 rounded-full bg-navy-600 overflow-hidden">
                <span
                  className="block h-full bg-emerald-400 transition-[width] duration-100 ease-linear"
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </span>
              <span className="tabular-nums whitespace-nowrap w-24 text-right">
                {overrun ? t('almostThere') : t('secondsLeft', { seconds: secondsLeft })}
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
