'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Bell,
  MessageSquare,
  Reply,
  Target,
  AtSign,
  Megaphone,
  CheckCheck,
  Loader2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { NotificationType } from '@prisma/client'
import EmptyState from '@/components/ui/EmptyState'
import { UserLink } from '@/components/UserLink'
import { notifyUnreadCountChanged } from '@/lib/hooks/useUnreadCount'

interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  link: string | null
  read: boolean
  createdAt: string
  actorId?: string | null
  actor?: {
    id: string
    name: string | null
    username: string | null
    image: string | null
    avatarUrl?: string | null
  } | null
}

interface NotificationListProps {
  initialNotifications: Notification[]
  initialTotal: number
  initialUnreadCount: number
}

const TYPE_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  COMMITMENT_RESOLVED: Target,
  COMMENT_ON_FORECAST: MessageSquare,
  REPLY_TO_COMMENT: Reply,
  NEW_COMMITMENT: Bell,
  MENTION: AtSign,
  SYSTEM: Megaphone,
}

export default function NotificationList({
  initialNotifications,
  initialTotal,
  initialUnreadCount,
}: NotificationListProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [total, setTotal] = useState(initialTotal)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)

  const page = Math.ceil(notifications.length / 20)
  const hasMore = notifications.length < total

  const handleClick = useCallback(async (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))

      try {
        const res = await fetch(`/api/notifications/${notification.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        })
        if (res.ok) {
          notifyUnreadCountChanged() // sidebar badge refetches immediately
          router.refresh() // invalidate router cache so next visit shows updated state
        } else {
          // Rollback
          setNotifications((prev) =>
            prev.map((n) => (n.id === notification.id ? { ...n, read: false } : n)),
          )
          setUnreadCount((prev) => prev + 1)
        }
      } catch {
        // Rollback on network error
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read: false } : n)),
        )
        setUnreadCount((prev) => prev + 1)
      }
    }

    // Navigate to link
    if (notification.link) {
      router.push(notification.link)
    }
  }, [router])

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAllRead(true)
    try {
      const res = await fetch('/api/notifications', { method: 'POST' })
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
        setUnreadCount(0)
        notifyUnreadCountChanged(0) // sidebar badge clears immediately
        router.refresh() // invalidate router cache so next visit shows updated state
      } else {
        toast.error('Failed to mark notifications as read')
      }
    } catch {
      toast.error('Failed to mark notifications as read')
    } finally {
      setMarkingAllRead(false)
    }
  }, [router])

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/notifications?page=${page + 1}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setNotifications((prev) => [...prev, ...data.notifications])
        setTotal(data.pagination.total)
      } else {
        toast.error('Failed to load more notifications')
      }
    } catch {
      toast.error('Failed to load more notifications')
    } finally {
      setLoadingMore(false)
    }
  }, [page])

  if (notifications.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<Bell className="w-10 h-10 text-gray-300" />}
        description={
          <>
            <p>No notifications yet</p>
            <p className="text-sm mt-1">When someone interacts with your forecasts, you&apos;ll see it here.</p>
          </>
        }
      />
    )
  }

  return (
    <div>
      {/* Header actions */}
      {unreadCount > 0 && (
        <div className="flex justify-end mb-4">
          <button
            onClick={handleMarkAllRead}
            disabled={markingAllRead}
            aria-label="Mark all notifications as read"
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-cobalt-light font-medium disabled:opacity-50"
          >
            {markingAllRead ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCheck className="w-4 h-4" />
            )}
            Mark all as read
          </button>
        </div>
      )}

      {/* Notification list */}
      <div className="space-y-1">
        {notifications.map((notification) => {
          const Icon = TYPE_ICONS[notification.type] || Bell

          return (
            <div
              key={notification.id}
              className={`w-full flex items-start gap-3 p-4 rounded-lg transition-colors group relative ${
                !notification.read ? 'bg-cobalt/10/50' : 'hover:bg-navy-800'
              }`}
            >
              {/* Entire notification area links to target */}
              <button
                onClick={() => handleClick(notification)}
                className="absolute inset-0 z-0"
                aria-label={`${notification.title}${!notification.read ? ', unread' : ''}`}
              />
              
              <div className={`mt-0.5 p-2 rounded-full shrink-0 z-10 ${
                !notification.read ? 'bg-blue-100 text-blue-600' : 'bg-navy-700 text-gray-500'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              
              <div className="flex-1 min-w-0 z-10 pointer-events-none">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm ${!notification.read ? 'font-semibold text-white' : 'font-medium text-text-secondary'}`}>
                    {notification.title}
                  </p>
                  {!notification.read && (
                    <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{notification.message}</p>
                
                <div className="flex items-center gap-2 mt-2">
                  {notification.actor && (
                    <div className="pointer-events-auto">
                      <UserLink
                        userId={notification.actor.id}
                        username={notification.actor.username}
                        name={notification.actor.name}
                        image={notification.actor.image || notification.actor.avatarUrl}
                        showAvatar={true}
                        avatarSize={16}
                        className="text-[10px] text-gray-400 font-medium hover:text-blue-600"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            aria-label={`Load more notifications, ${total - notifications.length} remaining`}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-cobalt-light border border-cobalt/30 rounded-lg hover:bg-cobalt/10 disabled:opacity-50"
          >
            {loadingMore ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              `Load more (${total - notifications.length} remaining)`
            )}
          </button>
        </div>
      )}
    </div>
  )
}
