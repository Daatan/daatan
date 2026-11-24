'use client'

import { useSearchParams } from 'next/navigation'
import ExpressForecastClient from '@/app/forecasts/express/ExpressForecastClient'
import { ForecastWizard } from '@/components/forecasts/ForecastWizard'
import { useCapabilities } from '@/components/CapabilitiesProvider'

interface CreateForecastClientProps {
  userId: string
  /** Shows the admin-only "publish as Daatan" option (#2301); the API enforces it too. */
  isAdmin?: boolean
}

export default function CreateForecastClient({ userId, isAdmin = false }: CreateForecastClientProps) {
  const searchParams = useSearchParams()
  const { ai } = useCapabilities()
  const fromExpress = searchParams.get('from') === 'express'

  // Express is an AI feature — when AI is off (self-host default), the step
  // wizard is the only way to create a forecast.
  if (!ai) {
    return (
      <div className="max-w-4xl mx-auto">
        <ForecastWizard isExpressFlow={false} isAdmin={isAdmin} />
      </div>
    )
  }

  // When redirected from express generation, go straight to the review wizard
  if (fromExpress) {
    return (
      <div className="max-w-4xl mx-auto">
        <ForecastWizard isExpressFlow={true} isAdmin={isAdmin} />
      </div>
    )
  }

  // daatan#2067: Express is the only create mode when AI is on (Manual removed).
  return (
    <div className="max-w-4xl mx-auto">
      <ExpressForecastClient userId={userId} isAdmin={isAdmin} />
    </div>
  )
}
