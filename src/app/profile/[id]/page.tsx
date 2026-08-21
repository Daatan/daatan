import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { UserProfileView } from '@/components/profile/UserProfileView'
import { loadProfileScores, loadProfileTab } from '@/lib/services/profile'
import type { ProfileTab } from '@/lib/services/profile'
import { JsonLd } from '@/components/JsonLd'
import { getAppUrl } from '@/lib/branding'

export const dynamic = 'force-dynamic'

const VALID_TABS: ProfileTab[] = ['created', 'participated', 'resolved']

interface ProfilePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tag?: string; tab?: string; page?: string }>
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { id } = await params
  const user = await prisma.user.findFirst({
    where: { OR: [{ id }, { username: id }] },
    select: {
      name: true,
      username: true,
      isPublic: true,
      _count: {
        select: {
          predictions: { where: { isPublic: true } },
          commitments: { where: { prediction: { isPublic: true } } },
        },
      },
    },
  })

  if (!user) {
    return { title: 'User Not Found - DAATAN', robots: { index: false } }
  }

  if (!user.isPublic) {
    return {
      title: `${user.name} - DAATAN Profile`,
      robots: { index: false, follow: false },
    }
  }

  const hasContent = user._count.predictions > 0 || user._count.commitments > 0
  const title = `${user.name} (@${user.username}) - DAATAN Profile`
  const description = `Check out ${user.name}'s prediction track record on DAATAN.`

  return {
    title,
    description,
    alternates: { canonical: `${getAppUrl()}/profile/${user.username}` },
    openGraph: {
      title,
      description,
      type: 'profile',
      url: `${getAppUrl()}/profile/${user.username}`,
    },
    twitter: { card: 'summary_large_image', title, description },
    ...(!hasContent ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function PublicProfilePage({ params, searchParams }: ProfilePageProps) {
  const { id } = await params
  const { tag: selectedTag = null, tab: tabParam, page: pageParam } = await searchParams

  const tab: ProfileTab = VALID_TABS.includes(tabParam as ProfileTab)
    ? (tabParam as ProfileTab)
    : 'created'
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  // Check session before try/catch — redirect() throws internally
  const session = await auth()
  if (session?.user?.id === id) {
    redirect('/profile')
  }

  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id }, { username: id }] },
      select: {
        id: true,
        name: true,
        image: true,
        username: true,
        role: true,
        website: true,
        twitterHandle: true,
        rs: true,
        mu: true,
        sigma: true,
        eloRating: true,
        createdAt: true,
        _count: { select: { predictions: true, commitments: true } },
      },
    })

    if (!user) {
      notFound()
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
      loadProfileTab({ userId: user.id, isPublic: true, selectedTag, tab, page }),
    ])

    const appUrl = getAppUrl()
    const personJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: user.name,
      identifier: `@${user.username}`,
      url: `${appUrl}/profile/${user.username}`,
      ...(user.image && { image: user.image }),
      ...(user.website && { sameAs: [user.website] }),
    }

    const breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: appUrl },
        {
          '@type': 'ListItem',
          position: 2,
          name: user.name ?? user.username,
          item: `${appUrl}/profile/${user.username}`,
        },
      ],
    }

    return (
      <>
        <JsonLd data={personJsonLd} />
        <JsonLd data={breadcrumbJsonLd} />
        <UserProfileView
          user={user}
          userTags={userTags}
          selectedTag={selectedTag}
          isOwnProfile={false}
          scores={scores}
          tabData={tabData}
        />
      </>
    )
  } catch (error) {
    createLogger('public-profile').error({ err: error, userId: id }, 'Public profile page error')
    notFound()
  }
}
