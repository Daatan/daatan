'use client'

import Image from 'next/image'
import { useState, useMemo } from 'react'

interface AvatarProps {
  src: string | null | undefined
  name: string | null | undefined
  size?: number
  className?: string
}

// Deterministic color based on name string
const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-emerald-100', text: 'text-emerald-600' },
  { bg: 'bg-violet-100', text: 'text-violet-600' },
  { bg: 'bg-amber-100', text: 'text-amber-600' },
  { bg: 'bg-rose-100', text: 'text-rose-600' },
  { bg: 'bg-cyan-100', text: 'text-cyan-600' },
  { bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { bg: 'bg-orange-100', text: 'text-orange-600' },
]

const getInitials = (name: string | null | undefined): string => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  return parts[0].charAt(0).toUpperCase()
}

const getColorIndex = (name: string | null | undefined): number => {
  if (!name) return 0
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % AVATAR_COLORS.length
}

export function Avatar({ src, name, size = 32, className = '' }: AvatarProps) {
  const [imageError, setImageError] = useState(false)

  const initials = useMemo(() => getInitials(name), [name])
  const color = useMemo(() => AVATAR_COLORS[getColorIndex(name)], [name])

  // Adjust font size: smaller for two-letter initials
  const fontSize = initials.length > 1 ? size * 0.38 : size * 0.5

  // Show fallback if no src or image failed to load
  if (!src || imageError) {
    return (
      <div
        className={`rounded-full ${color.bg} flex items-center justify-center ${color.text} font-bold ${className}`}
        style={{ width: size, height: size, fontSize }}
      >
        {initials}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={name || 'User'}
      width={size}
      height={size}
      className={`rounded-full border border-navy-600 ${className}`}
      onError={() => setImageError(true)}
    />
  )
}
