'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Undo2, Loader2 } from 'lucide-react'
import type { Prediction } from './types'

const RESOLVED_STATUSES = ['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']

interface Props {
  prediction: Prediction
  // The parent holds the prediction in client state, and a revert changes too many
  // fields to patch there, so it refetches.
  onReverted: () => void | Promise<void>
}

/**
 * Admin-only revert of a mistaken resolution (daatan#2077). Renders nothing unless the
 * forecast is resolved and the viewer is an admin. A refusal is shown as the server wrote
 * it, because it says what to do next, such as which later resolution to revert first.
 */
export function RevertResolutionAdmin({ prediction, onReverted }: Props) {
  const { data: session } = useSession()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (session?.user?.role !== 'ADMIN' || !RESOLVED_STATUSES.includes(prediction.status)) return null

  async function revert() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/forecasts/${prediction.id}/unresolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Revert failed')
      }
      toast.success('Resolution reverted')
      setConfirming(false)
      setReason('')
      await onReverted()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revert failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-8 p-4 border border-red-500/30 rounded-xl bg-navy-700">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="px-3 py-2 text-sm font-semibold bg-red-700 hover:bg-red-600 text-white rounded-lg inline-flex items-center gap-1.5"
        >
          <Undo2 className="w-3.5 h-3.5" /> Revert resolution
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-red-300">
            This restores everyone&apos;s scores and ratings from before the resolution and reopens
            the forecast, which can then be resolved again. Notifications already sent are not
            recalled.
          </p>
          <label className="block text-sm text-gray-300">
            Reason (required)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={2}
              className="mt-1 w-full rounded-lg bg-navy-800 border border-navy-600 p-2 text-sm text-white"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={revert}
              disabled={busy || !reason.trim()}
              className="px-3 py-2 text-sm font-semibold bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirm revert
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-3 py-2 text-sm text-gray-300 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
