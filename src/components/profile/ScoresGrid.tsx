import { getTranslations } from 'next-intl/server'
import { GlickoChart } from './GlickoChart'
import { CalibrationChart } from './CalibrationChart'
import type { ProfileScores, TopicStat } from '@/lib/services/profile'

interface ScoresGridProps {
  scores: ProfileScores
  user: { eloRating: number; mu: number; sigma: number; rs: number }
  userId: string
  selectedTag: string | null
  tagName: string | null
}

function ScoreCard({
  label,
  value,
  sub,
  color = 'default',
  title,
  muted,
}: {
  label: string
  value: string
  sub?: string
  color?: 'default' | 'purple' | 'blue' | 'teal' | 'red' | 'muted'
  title?: string
  muted?: boolean
}) {
  const valueClass =
    color === 'purple'
      ? 'text-purple-400'
      : color === 'blue'
        ? 'text-blue-400'
        : color === 'teal'
          ? 'text-teal'
          : color === 'red'
            ? 'text-red-400'
            : color === 'muted'
              ? 'text-gray-500'
              : 'text-text-secondary'

  return (
    <div
      className={`px-4 py-3 bg-navy-800 rounded-xl border ${muted ? 'border-navy-700' : 'border-navy-600'}`}
      title={title}
    >
      <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block leading-tight mb-1">
        {label}
      </span>
      <span className={`text-sm font-bold ${valueClass}`}>{value}</span>
      {sub && <span className="text-[10px] text-gray-400 block mt-0.5">{sub}</span>}
    </div>
  )
}

function SignedCard({
  label,
  value,
  sub,
  title,
}: {
  label: string
  value: number
  sub?: string
  title?: string
}) {
  return (
    <ScoreCard
      label={label}
      value={`${value >= 0 ? '+' : ''}${value}`}
      sub={sub}
      color={value >= 0 ? 'teal' : 'red'}
      title={title}
    />
  )
}

export async function ScoresGrid({ scores, user, userId, selectedTag, tagName }: ScoresGridProps) {
  const t = await getTranslations('profile')
  const tag = tagName ?? selectedTag
  const tagSuffix = tag ? ` · ${tag}` : ''

  return (
    <div className="mb-8 space-y-4">
      <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{t('performance')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <ScoreCard
          label={t('eloRating')}
          value={String(Math.round(user.eloRating))}
          sub={t('eloSub')}
          color="blue"
          title={t('eloTitle')}
        />
        <ScoreCard
          label={t('glickoLabel')}
          value={t('glickoValue', { mu: Math.round(user.mu) })}
          sub={t('glickoSub', { sigma: Math.round(user.sigma) })}
          color="blue"
          title={t('glickoTitle')}
        />
        {scores.avgBrierScore !== null && (
          <ScoreCard
            label={`${t('brierScore')}${tagSuffix}`}
            value={scores.avgBrierScore.toFixed(3)}
            sub={`${t('brierSub', { count: scores.brierCount })}${scores.brierCount < 5 ? t('brierLimited') : ''}`}
            color="purple"
            title={t('brierTitle')}
          />
        )}
        {scores.accuracy !== null && (
          <ScoreCard
            label={`${t('accuracy')}${tagSuffix}`}
            value={`${Math.round(scores.accuracy * 100)}%`}
            sub={t('accuracySub', { count: scores.accuracyResolved })}
            title={t('accuracyTitle')}
          />
        )}
        {scores.truthScore !== null && (
          <SignedCard
            label={t('truthScore')}
            value={Number(scores.truthScore.toFixed(4))}
            sub={t('truthSub')}
            title={t('truthTitle')}
          />
        )}
        {scores.weightedPeerScore !== null ? (
          <SignedCard
            label={`${t('wtdPeer')}${tagSuffix}`}
            value={Number(scores.weightedPeerScore.toFixed(4))}
            sub={t('wtdPeerSub')}
            title={t('wtdPeerTitle')}
          />
        ) : scores.weightedPeerCount > 0 && (
          <ScoreCard
            label={t('wtdPeer')}
            value="—"
            sub={t('wtdPeerNeed', { count: 3 - scores.weightedPeerCount })}
            color="muted"
            muted
            title={t('wtdPeerTitleNeed')}
          />
        )}
        {scores.peerScoreSum !== null && (
          <SignedCard
            label={`${t('peerScore')}${tagSuffix}`}
            value={Number(scores.peerScoreSum.toFixed(2))}
            sub={t('peerSub', { count: scores.peerScoreCount })}
            title={t('peerTitle')}
          />
        )}
        {scores.roi !== null && (
          <SignedCard
            label={t('roi')}
            value={Number(scores.roi.toFixed(2))}
            sub={t('roiSub')}
            title={t('roiTitle')}
          />
        )}
        {scores.aiScoreSum !== null && (
          <SignedCard
            label={`${t('aiScore')}${tagSuffix}`}
            value={Number(scores.aiScoreSum.toFixed(2))}
            sub={t('aiSub', { count: scores.aiScoreCount })}
            title={t('aiTitle')}
          />
        )}
        {scores.rsTagDelta !== null && (
          <SignedCard
            label={`RS · ${tag}`}
            value={Number(scores.rsTagDelta.toFixed(1))}
            title={t('rsTagTitle', { tag: tag ?? '' })}
          />
        )}
        <ScoreCard
          label={t('reputation')}
          value={t('reputationValue', { rs: user.rs.toFixed(1) })}
          sub={t('reputationSub')}
          color="muted"
          muted
          title={t('reputationTitle')}
        />
      </div>

      {scores.topicBreakdown.length > 0 && !selectedTag && (
        <TopicBreakdown topics={scores.topicBreakdown} title={t('peerByTopic')} />
      )}

      <div className="bg-navy-800 rounded-xl border border-navy-600 p-3">
        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">
          {t('glickoHistory')}{tagSuffix}
        </p>
        <GlickoChart userId={userId} selectedTag={selectedTag} />
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

function TopicBreakdown({ topics, title }: { topics: TopicStat[]; title: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">
        {topics.map(topic => (
          <div
            key={topic.slug}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 rounded-lg border border-navy-600 text-xs"
          >
            <span className="text-gray-300 font-medium">{topic.name}</span>
            <span className={`font-bold ${topic.peerScoreAvg >= 0 ? 'text-teal' : 'text-red-400'}`}>
              {topic.peerScoreAvg >= 0 ? '+' : ''}
              {topic.peerScoreAvg.toFixed(3)}
            </span>
            <span className="text-gray-500">({topic.count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}
