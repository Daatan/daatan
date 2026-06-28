'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Zap, Edit3 } from 'lucide-react'
import ExpressForecastClient from '@/app/forecasts/express/ExpressForecastClient'
import { ForecastWizard } from '@/components/forecasts/ForecastWizard'
import { useCapabilities } from '@/components/CapabilitiesProvider'

interface CreateForecastClientProps {
  userId: string
}

export default function CreateForecastClient({ userId }: CreateForecastClientProps) {
  const searchParams = useSearchParams()
  const { ai } = useCapabilities()
  const fromExpress = searchParams.get('from') === 'express'
  const [mode, setMode] = useState<'express' | 'manual'>('express')
  const [sharedUserInput, setSharedUserInput] = useState('')

  // Express is an AI feature — when AI is off (self-host default), only the
  // manual wizard is available; skip the mode toggle entirely.
  if (!ai) {
    return (
      <div className="max-w-4xl mx-auto">
        <ForecastWizard isExpressFlow={false} />
      </div>
    )
  }

  // When redirected from express generation, go straight to the wizard
  if (fromExpress) {
    return (
      <div className="max-w-4xl mx-auto">
        <ForecastWizard isExpressFlow={true} />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Mode Toggle */}
      <div className="mb-6 flex items-center justify-center gap-2 bg-navy-700 p-1 rounded-lg w-fit mx-auto">
        <button
          onClick={() => setMode('express')}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all
            ${mode === 'express'
              ? 'bg-navy-700 text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-white'
            }
          `}
        >
          <Zap className="w-4 h-4" />
          Express
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all
            ${mode === 'manual'
              ? 'bg-navy-700 text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-white'
            }
          `}
        >
          <Edit3 className="w-4 h-4" />
          Manual
        </button>
      </div>

      {/* Content */}
      {mode === 'express' ? (
        <ExpressForecastClient 
          userId={userId} 
          initialInput={sharedUserInput}
          onInputChange={setSharedUserInput}
        />
      ) : (
        <ForecastWizard 
          isExpressFlow={false} 
          initialClaim={sharedUserInput}
        />
      )}
    </div>
  )
}
