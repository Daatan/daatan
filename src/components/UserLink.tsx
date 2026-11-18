'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { Avatar } from './Avatar'

interface UserLinkProps {
  userId: string
  username?: string | null
  name?: string | null
  image?: string | null
  showAvatar?: boolean
  /** false = avatar only (the name becomes the link's aria-label). Default true. */
  showName?: boolean
  avatarSize?: number
  className?: string
  children?: ReactNode
  onClick?: (e: React.MouseEvent) => void
}

/**
 * A reusable component for linking to a user's profile.
 * Can wrap an avatar, a name, or both.
 */
export function UserLink({
  userId,
  username,
  name,
  image,
  showAvatar = false,
  showName = true,
  avatarSize = 24,
  className = '',
  children,
  onClick
}: UserLinkProps) {
  // Use username if available, otherwise fallback to userId
  // We prefer linking to /profile/username if possible for SEO/UX, 
  // but /profile/userId is more robust if username is missing.
  const profileHref = `/profile/${userId}`
  const displayName = name || (username ? `@${username}` : 'Anonymous')

  return (
    <Link 
      href={profileHref}
      onClick={onClick}
      aria-label={showName ? undefined : displayName}
      className={`inline-flex items-center gap-2 hover:opacity-80 transition-opacity ${className}`}
    >
      {showAvatar && (
        <Avatar 
          src={image} 
          name={name || username || 'User'} 
          size={avatarSize} 
          className="shrink-0"
        />
      )}
      {children || (showName && (
        <span className="font-bold text-white">{displayName}</span>
      ))}
    </Link>
  )
}
