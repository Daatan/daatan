'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { ShieldAlert, Loader2 } from 'lucide-react'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  // The parent holds the prediction in client state, so router.refresh() alone
  // can't hide this banner — the parent must drop `settled` itself.
  onCleared: () => void
}

/**
 * Admin-only override for a false-positive Oracul settlement pin (the
 * 2026-07-08 F-35 incident was fixed by hand via a prod DB UPDATE — this is
 * that fix, self-service). recordEstimate can only ever set `settled: true`
 * (docs/DATABASE.md "Settlement latch"); this is the only way to clear it.
 * Renders nothing unless the forecast is currently settled AND the viewer
 * is an admin.
 */
export function SettledLatchAdmin({ prediction, onCleared }: Props) {
  const { data: session } = useSession()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (session?.user?.role !== 'ADMIN' || !prediction.settled) return null

  async function clear() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/forecasts/${prediction.id}/settled`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Clear failed')
      toast.success('Settlement flag cleared')
      onCleared()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Clear failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-8 p-4 border border-amber-500/30 rounded-xl bg-navy-700">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-amber-300">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            The Oracul reported this outcome as an accomplished fact. If that was a false
            settlement (a background fact misread as a live event), clear it — the forecast
            leaves Awaiting Resolution now and resumes daily glide on the next requote run.
          </span>
        </div>
        <button
          onClick={clear}
          disabled={busy}
          className="px-3 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1 shrink-0"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Clear settlement
        </button>
      </div>
    </div>
  )
}
