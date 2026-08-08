'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2 } from 'lucide-react'

export type StepState = 'done' | 'active' | 'pending'

export interface ProgressStep {
  key: string
  label: string
  state: StepState
}

interface SubmitProgressProps {
  /** Ordered list of steps to render, e.g. one entry per calibrated phase. */
  steps: ProgressStep[]
  /** Calibrated estimate (ms) for whichever step is currently 'active', used for the progress bar/countdown. */
  activeEstimateMs: number
}

/**
 * Inline step progress shown beneath a submit/run button while a blocking
 * request is in flight. Estimates are client-side (calibrated via
 * localStorage) — the server does the real work opaquely, so the bar is a
 * calibrated estimate, not a live server feed. Generic over the step list so
 * it can drive forecast creation/resolution and admin bot runs alike (daatan#1139).
 */
export function SubmitProgress({ steps, activeEstimateMs }: SubmitProgressProps) {
  const t = useTranslations('wizard')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number>(Date.now())
  const activeKey = steps.find((s) => s.state === 'active')?.key

  // Restart the elapsed timer whenever the active step changes.
  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    if (!activeKey) return
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100)
    return () => clearInterval(id)
  }, [activeKey])

  const overrun = elapsed >= activeEstimateMs
  const ratio = overrun ? 0.95 : Math.min(elapsed / activeEstimateMs, 0.95)
  const secondsLeft = Math.max(0, Math.ceil((activeEstimateMs - elapsed) / 1000))

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
