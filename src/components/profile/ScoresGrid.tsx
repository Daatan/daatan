import { getTranslations } from 'next-intl/server'
import { CalibrationChart } from './CalibrationChart'
import type { ProfileScores } from '@/lib/services/profile'

interface ScoresGridProps {
  scores: ProfileScores
  tagName: string | null
}

// ELO is the headline rating and lives in the profile header; this grid is the
// two plain-language checks on it. Every other scoring system is still computed
// by loadProfileScores and available on the leaderboard API — just not shown.
function ScoreCard({
  label,
  value,
  sub,
  desc,
  color = 'default',
  muted,
}: {
  label: string
  value: string
  sub?: string
  desc: string
  color?: 'default' | 'purple' | 'muted'
  muted?: boolean
}) {
  const valueClass =
    color === 'purple' ? 'text-purple-400' : color === 'muted' ? 'text-gray-500' : 'text-text-secondary'

  return (
    <div className={`px-4 py-3 bg-navy-800 rounded-xl border ${muted ? 'border-navy-700' : 'border-navy-600'}`}>
      <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block leading-tight mb-1">
        {label}
      </span>
      <span className={`text-2xl font-black ${valueClass}`}>{value}</span>
      {sub && <span className="text-[10px] text-gray-400 block mt-0.5">{sub}</span>}
      <p className="text-xs text-gray-500 leading-relaxed mt-2">{desc}</p>
    </div>
  )
}

export async function ScoresGrid({ scores, tagName }: ScoresGridProps) {
  const t = await getTranslations('profile')
  const tagSuffix = tagName ? ` · ${tagName}` : ''
  const accuracyMissing = Math.max(0, 3 - scores.accuracyResolved)

  return (
    <div className="mb-8 space-y-4">
      <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{t('performance')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {scores.accuracy !== null ? (
          <ScoreCard
            label={`${t('accuracy')}${tagSuffix}`}
            value={`${Math.round(scores.accuracy * 100)}%`}
            sub={t('accuracySub', { count: scores.accuracyResolved })}
            desc={t('accuracyDesc')}
          />
        ) : (
          <ScoreCard
            label={`${t('accuracy')}${tagSuffix}`}
            value="—"
            sub={t('accuracyNeed', { count: accuracyMissing })}
            desc={t('accuracyDesc')}
            color="muted"
            muted
          />
        )}
        {scores.avgBrierScore !== null ? (
          <ScoreCard
            label={`${t('brierScore')}${tagSuffix}`}
            value={scores.avgBrierScore.toFixed(3)}
            sub={`${t('brierSub', { count: scores.brierCount })}${scores.brierCount < 5 ? t('brierLimited') : ''}`}
            desc={t('brierDesc')}
            color="purple"
          />
        ) : (
          <ScoreCard
            label={`${t('brierScore')}${tagSuffix}`}
            value="—"
            sub={t('brierNone')}
            desc={t('brierDesc')}
            color="muted"
            muted
          />
        )}
      </div>

      {scores.calibration.length >= 2 && (
        <div className="bg-navy-800 rounded-xl border border-navy-600 p-3">
          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">
            {t('calibration')}{tagSuffix}
          </p>
          <p className="text-[10px] text-gray-600 mb-2">{t('calibrationDesc')}</p>
          <CalibrationChart calibration={scores.calibration} />
        </div>
      )}
    </div>
  )
}
