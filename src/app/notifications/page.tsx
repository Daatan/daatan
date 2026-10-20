import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import NotificationList from '@/components/notifications/NotificationList'
import { Bell } from 'lucide-react'


export default async function NotificationsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/notifications')
  }

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.notification.count({
      where: { userId: session.user.id },
    }),
    prisma.notification.count({
      where: { userId: session.user.id, read: false },
    }),
  ])

  // Enrich with actor info
  const actorIds = [...new Set(notifications.map(n => n.actorId).filter(Boolean) as string[])]
  const actors = actorIds.length > 0 
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, username: true, image: true, avatarUrl: true }
      })
    : []
  
  const actorMap = Object.fromEntries(actors.map(a => [a.id, a]))

  const enrichedNotifications = notifications.map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    actorId: n.actorId,
    actor: n.actorId ? (actorMap[n.actorId] ?? null) : null,
  }))

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center gap-2 mb-8">
        <Bell className="w-8 h-8 text-blue-600" />
        <h1 className="text-2xl font-bold">Notifications</h1>
      </div>

      <NotificationList
        initialNotifications={enrichedNotifications}
        initialTotal={total}
        initialUnreadCount={unreadCount}
      />
    </div>
  )
}
