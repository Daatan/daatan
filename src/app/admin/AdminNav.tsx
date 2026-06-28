'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

export default function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('admin')
  const pathname = usePathname()
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  const TABS = [
    { id: 'approvals', label: t('tabApprovals') },
    { id: 'forecasts', label: t('tabForecasts') },
    { id: 'comments', label: t('tabComments') },
    { id: 'users', label: t('tabUsers'), adminOnly: true },
    { id: 'invites', label: t('tabInvites'), adminOnly: true },
    { id: 'bots', label: t('tabBots'), adminOnly: true },
    { id: 'oracle', label: t('tabOracle'), adminOnly: true },
    { id: 'sources', label: t('tabSources'), adminOnly: true },
  ]

  useEffect(() => {
    fetch('/api/admin/approvals?limit=1')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => data && setPendingCount(data.total))
      .catch(() => { })
  }, [])

  return (
    <div className="flex gap-1 sm:gap-4 border-b mb-6 overflow-x-auto whitespace-nowrap pb-1 scrollbar-hide -mx-2 px-2">
      {TABS.filter(tab => !tab.adminOnly || isAdmin).map(tab => {
        const href = `/admin/${tab.id}`
        const active = pathname === href || pathname.startsWith(href + '/')
        const showBadge = tab.id === 'approvals' && pendingCount !== null && pendingCount > 0
        return (
          <Link
            key={tab.id}
            href={href}
            className={`px-3 sm:px-4 py-2 shrink-0 text-sm transition-colors ${active
              ? 'border-b-2 border-blue-500 font-bold text-blue-600'
              : 'text-gray-500 hover:text-text-secondary'
              }`}
          >
            {tab.label}
            {showBadge && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
