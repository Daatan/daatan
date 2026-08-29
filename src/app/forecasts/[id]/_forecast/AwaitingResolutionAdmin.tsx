'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  // The parent holds the prediction in client state — it must drop the flag itself.
  onDismissed: () => void
}

/**
 * Admin-only dismissal from the Awaiting Resolution queue (daatan#1659). The
 * queue is fed by `awaitingAiResolution`, which the funnel recomputes from the
 * bare probability on every estimate write — so a plain clear lasts one requote.
 * This dismissal is sticky until the estimate actually moves. Renders nothing
 * unless the forecast is flagged AND the viewer is an admin.
 */
export function AwaitingResolutionAdmin({ prediction, onDismissed }: Props) {
  const { data: session } = useSession()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (session?.user?.role !== 'ADMIN' || !prediction.awaitingAiResolution || prediction.status !== 'ACTIVE') return null

  async function dismiss() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/forecasts/${prediction.id}/awaiting`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Dismiss failed')
      toast.success('Removed from Awaiting Resolution')
      onDismissed()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dismiss failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-8 p-4 border border-yellow-500/30 rounded-xl bg-navy-700" data-testid="awaiting-resolution-admin">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-yellow-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            This forecast is in the Awaiting Resolution queue — the AI is confident about the
            outcome (or a clock alert flagged it). If it is not resolvable yet, dismiss it: it
            stays out of the queue until the AI estimate moves by more than 5 points.
          </span>
        </div>
        <button
          onClick={dismiss}
          disabled={busy}
          className="px-3 py-2 text-sm font-semibold bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1 shrink-0"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Dismiss from Awaiting Resolution
        </button>
      </div>
    </div>
  )
}
