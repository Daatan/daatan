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


const VALID_TABS: ProfileTab[] = ['created', 'participated', 'resolved']

// Users without a username are still reachable by id (the lookup matches either), so the
// id is their canonical path — `/profile/${username}` alone yielded `/profile/null` (#2052).
function profileUrl(user: { id: string; username: string | null }): string {
  return `${getAppUrl()}/profile/${user.username ?? user.id}`
}

interface ProfilePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tag?: string; tab?: string; page?: string }>
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { id } = await params
  const user = await prisma.user.findFirst({
    where: { OR: [{ id }, { username: id }] },
    select: {
      id: true,
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
    return { title: 'User Not Found', robots: { index: false } }
  }

  if (!user.isPublic) {
    return {
      title: `${user.name} — Profile`,
      robots: { index: false, follow: false },
    }
  }

  const hasContent = user._count.predictions > 0 || user._count.commitments > 0
  // Bare: the root layout's `%s | DAATAN` template adds the brand (#2059).
  const title = user.username
    ? `${user.name} (@${user.username}) — Forecast Track Record`
    : `${user.name} — Forecast Track Record`
  const description = `Check out ${user.name}'s prediction track record on DAATAN.`
  const url = profileUrl(user)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} | DAATAN`,
      description,
      type: 'profile',
      url,
    },
    twitter: { card: 'summary_large_image', title: `${title} | DAATAN`, description },
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

  const { user, userTags, scores, tabData, personJsonLd, breadcrumbJsonLd } = await loadPublicProfile({ id, selectedTag, tab, page })

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
}

async function loadPublicProfile({ id, selectedTag, tab, page }: { id: string; selectedTag: string | null; tab: ProfileTab; page: number }) {
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
    const url = profileUrl(user)
    const personJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: user.name,
      ...(user.username && { identifier: `@${user.username}` }),
      url,
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
          item: url,
        },
      ],
    }

    return { user, userTags, scores, tabData, personJsonLd, breadcrumbJsonLd }
  } catch (error) {
    createLogger('public-profile').error({ err: error, userId: id }, 'Public profile page error')
    notFound()
  }
}
