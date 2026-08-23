'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { buildProfileUrl } from '@/components/profile/profile-url'

const MAX_VISIBLE = 8

interface Tag {
  name: string
  slug: string
  count?: number
}

interface TagFilterProps {
  tags: Tag[]
  selectedTag: string | null
  totalCount?: number
}

export function TagFilter({ tags, selectedTag, totalCount }: TagFilterProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState(false)

  if (tags.length === 0) return null

  const visibleTags = expanded ? tags : tags.slice(0, MAX_VISIBLE)
  const hiddenCount = tags.length - MAX_VISIBLE

  const pillBase = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-all'
  const active = 'bg-blue-600 text-white'
  const inactive = 'bg-navy-800 text-gray-400 border border-navy-600 hover:border-blue-500 hover:text-blue-400'

  return (
    <div className="flex flex-wrap gap-2 mt-3 items-center">
      <Link
        href={buildProfileUrl(pathname, { tag: null }, searchParams)}
        className={`${pillBase} ${!selectedTag ? active : inactive}`}
      >
        All
        {totalCount != null && (
          <span className={`ml-1.5 font-normal normal-case tracking-normal ${!selectedTag ? 'text-blue-100' : 'text-gray-500'}`}>{totalCount}</span>
        )}
      </Link>
      {visibleTags.map(tag => (
        <Link
          key={tag.slug}
          href={buildProfileUrl(pathname, { tag: tag.slug }, searchParams)}
          className={`${pillBase} ${selectedTag === tag.slug ? active : inactive}`}
        >
          {tag.name}
          {tag.count != null && (
            <span className={`ml-1.5 font-normal normal-case tracking-normal ${selectedTag === tag.slug ? 'text-blue-100' : 'text-gray-500'}`}>{tag.count}</span>
          )}
        </Link>
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="px-3 py-1 text-xs font-bold text-gray-500 hover:text-blue-400 transition-colors"
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="px-3 py-1 text-xs font-bold text-gray-500 hover:text-blue-400 transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  )
}
