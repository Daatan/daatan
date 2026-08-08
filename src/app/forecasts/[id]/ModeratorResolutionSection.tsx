'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Shield, ChevronDown, ChevronUp } from 'lucide-react'
import { ResolutionForm } from '@/components/forecasts/ResolutionForm'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface ModeratorResolutionSectionProps {
  predictionId: string
  predictionStatus: string
  outcomeType: string
  options: Array<{ id: string; text: string }>
  settled?: boolean
  confidence?: number | null
}

export function ModeratorResolutionSection({
  predictionId,
  predictionStatus,
  outcomeType,
  options,
  settled,
  confidence
}: ModeratorResolutionSectionProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations('forecast')
  const [open, setOpen] = useState(false)

  const canResolve =
    session?.user?.role === 'RESOLVER' ||
    session?.user?.role === 'ADMIN'

  const isResolvable =
    predictionStatus === 'ACTIVE' ||
    predictionStatus === 'PENDING'

  if (!canResolve || !isResolvable) {
    return null
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-blue-600 transition-colors"
      >
        <Shield className="w-4 h-4" />
        {t('resolverActions')}
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="mt-4">
          <ResolutionForm
            predictionId={predictionId}
            outcomeType={outcomeType}
            options={options}
            settled={settled}
            confidence={confidence}
            onResolved={() => router.refresh()}
          />
        </div>
      )}
    </div>
  )
}
