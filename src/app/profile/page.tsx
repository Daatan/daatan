import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { UserProfileView } from '@/components/profile/UserProfileView'
import { loadProfileScores, loadProfileTab } from '@/lib/services/profile'
import type { ProfileTab } from '@/lib/services/profile'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'My Profile - DAATAN',
  robots: { index: false },
}

const VALID_TABS: ProfileTab[] = ['created', 'participated', 'resolved']

interface ProfilePageProps {
  searchParams: Promise<{ tag?: string; tab?: string; page?: string }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const { tag: selectedTag = null, tab: tabParam, page: pageParam } = await searchParams
  const tab: ProfileTab = VALID_TABS.includes(tabParam as ProfileTab)
    ? (tabParam as ProfileTab)
    : 'created'
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  const userId = session.user.id

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        image: true,
        username: true,
        email: true,
        role: true,
        website: true,
        twitterHandle: true,
        rs: true,
        mu: true,
        sigma: true,
        eloRating: true,
        createdAt: true,
        _count: {
          select: { predictions: true, commitments: true },
        },
      },
    })

    if (!user) {
      redirect('/login')
    }

    const userTagsRaw = await prisma.tag.findMany({
      where: {
        predictions: {
          some: { commitments: { some: { userId: user.id } } },
        },
      },
      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            predictions: { where: { commitments: { some: { userId: user.id } } } },
          },
        },
      },
    })
    const userTags = userTagsRaw
      .sort((a, b) => b._count.predictions - a._count.predictions)
      .map(({ name, slug, _count }) => ({ name, slug, count: _count.predictions }))

    const [scores, tabData] = await Promise.all([
      loadProfileScores({ userId: user.id, selectedTag }),
      loadProfileTab({ userId: user.id, isPublic: false, selectedTag, tab, page }),
    ])

    return (
      <UserProfileView
        user={user}
        userTags={userTags}
        selectedTag={selectedTag}
        isOwnProfile={true}
        scores={scores}
        tabData={tabData}
      />
    )
  } catch (error) {
    createLogger('profile').error({ err: error, userId }, 'Profile page error')
    redirect('/login')
  }
}
