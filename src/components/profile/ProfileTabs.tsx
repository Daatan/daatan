'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buildProfileUrl } from './profile-url'
import type { ProfileTab } from '@/lib/services/profile'

const PAGE_SIZE = 20

interface ProfileTabsProps {
  activeTab: ProfileTab
  page: number
  createdTotal: number
  participatedTotal: number
  resolvedTotal: number
  children: React.ReactNode
}

export function ProfileTabs({
  activeTab,
  page,
  createdTotal,
  participatedTotal,
  resolvedTotal,
  children,
}: ProfileTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations('profile')

  const tabs: { key: ProfileTab; label: string; count: number }[] = [
    { key: 'created', label: t('created'), count: createdTotal },
    { key: 'participated', label: t('participated'), count: participatedTotal },
    { key: 'resolved', label: t('resolved'), count: resolvedTotal },
  ]

  const activeTotal = tabs.find(t => t.key === activeTab)?.count ?? 0
  const totalPages = Math.ceil(activeTotal / PAGE_SIZE)

  return (
    <div>
      <div className="flex gap-1 border-b border-navy-600 mb-6 overflow-x-auto">
        {tabs.map(({ key, label, count }) => (
          <Link
            key={key}
            href={buildProfileUrl(pathname, { tab: key }, searchParams)}
            className={`flex-shrink-0 px-4 py-2.5 text-sm font-bold rounded-t-lg transition-colors whitespace-nowrap ${
              activeTab === key
                ? 'bg-navy-700 border border-b-0 border-navy-600 text-white -mb-px'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs font-medium text-gray-500">({count})</span>
          </Link>
        ))}
      </div>

      {children}

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 mt-8">
          {page > 1 ? (
            <Link
              href={buildProfileUrl(pathname, { page: page - 1 }, searchParams)}
              className="px-4 py-2 bg-navy-700 border border-navy-600 rounded-lg text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              ← Prev
            </Link>
          ) : (
            <span className="px-4 py-2 text-sm text-gray-600 cursor-not-allowed">← Prev</span>
          )}
          <span className="text-sm text-gray-400">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildProfileUrl(pathname, { page: page + 1 }, searchParams)}
              className="px-4 py-2 bg-navy-700 border border-navy-600 rounded-lg text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              Next →
            </Link>
          ) : (
            <span className="px-4 py-2 text-sm text-gray-600 cursor-not-allowed">Next →</span>
          )}
        </div>
      )}
    </div>
  )
}
