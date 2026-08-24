import { getLocale, getTranslations } from 'next-intl/server'
import Image from 'next/image'
import { TrendingUp, Award, Settings, Globe, Twitter, Sparkles, Activity } from 'lucide-react'
import { ShareProfileButton } from '@/components/profile/ShareProfileButton'
import ForecastCard, { type Prediction } from '@/components/forecasts/ForecastCard'
import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'
import { RoleBadge } from '@/components/RoleBadge'
import { TagFilter } from '@/components/profile/TagFilter'
import { ScoresGrid } from '@/components/profile/ScoresGrid'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import type { ProfileScores, ProfileTabResult, CommitmentForList } from '@/lib/services/profile'

interface UserProfileViewProps {
  user: {
    id: string
    name: string | null
    image: string | null
    username: string | null
    role: string
    website: string | null
    twitterHandle: string | null
    rs: number
    mu: number
    sigma: number
    eloRating: number
    createdAt: Date | string
    email?: string | null
    _count: { predictions: number; commitments: number }
  }
  userTags: { name: string; slug: string; count?: number }[]
  selectedTag: string | null
  isOwnProfile: boolean
  scores: ProfileScores
  tabData: ProfileTabResult
}

export async function UserProfileView({
  user,
  userTags,
  selectedTag,
  isOwnProfile,
  scores,
  tabData,
}: UserProfileViewProps) {
  const t = await getTranslations('profile')
  const locale = await getLocale()
  const tagName = selectedTag ? (userTags.find(tg => tg.slug === selectedTag)?.name ?? selectedTag) : null
  const cardLabels: CardLabels = {
    yes: t('cardYes'),
    no: t('cardNo'),
    staked: t('cardStaked'),
    probYesTemplate: t.raw('cardProbYes'),
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Profile Header */}
      <div className="bg-navy-700 border border-navy-600 rounded-3xl p-6 sm:p-10 shadow-sm mb-6">
        <div className="flex flex-col md:flex-row items-center gap-8">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name || ''}
                width={128}
                height={128}
                className="rounded-3xl object-cover ring-4 ring-blue-50"
              />
            ) : (
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-3xl bg-blue-100 flex items-center justify-center text-4xl font-black text-blue-600 ring-4 ring-blue-50">
                {user.name?.charAt(0) || user.username?.charAt(0) || '?'}
              </div>
            )}
            <div className="absolute -bottom-2 -right-2 bg-navy-700 p-2 rounded-xl shadow-md border border-gray-50">
              <Award className="w-6 h-6 text-yellow-500" />
            </div>
          </div>

          {/* Name + meta */}
          <div className="flex-1 text-center md:text-left min-w-0">
            <div className="flex items-center justify-center md:justify-start gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl sm:text-4xl font-black text-white">{user.name || t('anonymous')}</h1>
              {user.role && <RoleBadge role={user.role as 'USER' | 'RESOLVER' | 'ADMIN'} size="md" />}
              {isOwnProfile && (
                <>
                  <Link
                    href="/profile/edit"
                    className="p-2 hover:bg-navy-600 rounded-lg transition-colors"
                    title={t('editProfile')}
                    aria-label={t('editProfile')}
                  >
                    <Settings className="w-5 h-5 text-gray-400 hover:text-gray-200" />
                  </Link>
                  {user.username && <ShareProfileButton username={user.username} />}
                </>
              )}
            </div>
            <p className="text-gray-500 font-medium mb-3">
              {user.username ? `@${user.username}` : user.email}
            </p>

            {(user.website || user.twitterHandle) && (
              <div className="flex items-center justify-center md:justify-start gap-3 mb-4 flex-wrap">
                {user.website && (
                  <a
                    href={user.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium"
                  >
                    <Globe className="w-4 h-4" />
                    {t('website')}
                  </a>
                )}
                {user.twitterHandle && (
                  <a
                    href={`https://twitter.com/${user.twitterHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium"
                  >
                    <Twitter className="w-4 h-4" />
                    @{user.twitterHandle}
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-center md:justify-start gap-3 mb-3">
              <div className="px-4 py-2 bg-navy-800 rounded-xl border border-navy-600">
                <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block">
                  {t('joined')}
                </span>
                <span className="text-sm font-bold text-text-secondary">
                  {new Date(user.createdAt).toLocaleDateString(locale, {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>

            <TagFilter tags={userTags} selectedTag={selectedTag} totalCount={user._count.commitments} />
          </div>

          {/* Skill Rating card */}
          <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-lg text-center flex-shrink-0 w-full md:w-auto md:min-w-[148px]">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
                {t('skillRating')}
              </span>
            </div>
            <p className="text-3xl font-black" title={t('skillMuTitle')}>
              {Math.round(user.mu)}
            </p>
            <p className="text-xs text-gray-400 mt-1" title={t('skillSigmaTitle')}>
              {t('uncertainty', { sigma: Math.round(user.sigma) })}
            </p>
            <p className="text-[10px] text-gray-600 mt-0.5">{t('glickoAvg')}</p>
          </div>
        </div>
      </div>

      {/* Scores section */}
      <ScoresGrid
        scores={scores}
        user={user}
        userId={user.id}
        selectedTag={selectedTag}
        tagName={tagName}
      />

      {/* Tabbed forecast lists */}
      <ProfileTabs
        activeTab={tabData.tab}
        page={tabData.page}
        createdTotal={tabData.createdTotal}
        participatedTotal={tabData.participatedTotal}
        resolvedTotal={tabData.resolvedTotal}
      >
        {tabData.tab === 'created' && (
          <CreatedList
            items={tabData.createdItems}
            isOwnProfile={isOwnProfile}
            emptyDesc={isOwnProfile ? t('noForecasts') : t('noPublicForecasts')}
            createLabel={t('createForecast')}
          />
        )}
        {tabData.tab === 'participated' && (
          <CommitmentList
            items={tabData.participatedItems}
            showScores={false}
            emptyDesc={t('noParticipationsFound')}
            labels={cardLabels}
          />
        )}
        {tabData.tab === 'resolved' && (
          <CommitmentList
            items={tabData.resolvedItems}
            showScores
            emptyDesc={t('noParticipationsFound')}
            labels={cardLabels}
          />
        )}
      </ProfileTabs>
    </div>
  )
}

function CreatedList({
  items,
  isOwnProfile,
  emptyDesc,
  createLabel,
}: {
  items: Prediction[]
  isOwnProfile: boolean
  emptyDesc: string
  createLabel: string
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<Sparkles className="w-7 h-7 text-purple-400" />}
        iconBgClass="bg-purple-900/20"
        description={emptyDesc}
        action={
          isOwnProfile
            ? { label: createLabel, href: '/create', variant: 'purple' }
            : undefined
        }
      />
    )
  }
  return (
    <div className="space-y-4">
      {items.map(prediction => (
        <ForecastCard key={prediction.id} prediction={prediction} />
      ))}
    </div>
  )
}

type CardLabels = {
  yes: string
  no: string
  staked: string
  probYesTemplate: string
}

function CommitmentList({
  items,
  showScores,
  emptyDesc,
  labels,
}: {
  items: CommitmentForList[]
  showScores: boolean
  emptyDesc: string
  labels: CardLabels
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<TrendingUp className="w-7 h-7 text-blue-400" />}
        iconBgClass="bg-cobalt/10"
        description={emptyDesc}
      />
    )
  }
  return (
    <div className="space-y-4">
      {items.map(commitment => (
        <CommitmentCard
          key={commitment.id}
          commitment={commitment}
          showScores={showScores}
          labels={labels}
        />
      ))}
    </div>
  )
}

function CommitmentCard({
  commitment,
  showScores,
  labels,
}: {
  commitment: CommitmentForList
  showScores: boolean
  labels: CardLabels
}) {
  const probLabel =
    commitment.probability != null
      ? labels.probYesTemplate.replace('{pct}', String(Math.round(commitment.probability * 100)))
      : commitment.binaryChoice != null
        ? commitment.binaryChoice
          ? labels.yes
          : labels.no
        : labels.staked

  const isCorrect = (commitment.rsChange ?? 0) > 0

  return (
    <div className="relative group">
      <ForecastCard prediction={commitment.prediction} />
      <div className="absolute top-3 right-3 flex flex-col items-end gap-1 pointer-events-none">
        <span className="px-2 py-0.5 bg-navy-900/90 border border-navy-600 text-xs font-bold rounded-full text-blue-300 backdrop-blur-sm">
          {probLabel}
        </span>
        {showScores && commitment.brierScore !== null && (
          <span
            className={`px-2 py-0.5 text-xs font-bold rounded-full backdrop-blur-sm ${
              isCorrect
                ? 'bg-teal/20 text-teal border border-teal/30'
                : 'bg-red-900/30 text-red-400 border border-red-800/30'
            }`}
            title={`Brier: ${commitment.brierScore.toFixed(3)} · Peer: ${commitment.peerScore != null ? (commitment.peerScore >= 0 ? '+' : '') + commitment.peerScore.toFixed(2) : '—'}`}
          >
            {isCorrect ? '✓' : '✗'} {commitment.brierScore.toFixed(3)}
          </span>
        )}
      </div>
    </div>
  )
}
