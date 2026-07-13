import type { ReactNode } from 'react'

/**
 * Amber advisory banner used on forecast screens (similar forecasts, unverified
 * AI dates). Children render below the title row inside the same card.
 */
export function WarningBanner({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="p-4 bg-navy-800 border border-yellow-600/40 rounded-lg space-y-2" role="alert">
      <div className="flex items-center gap-2 text-yellow-500 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}
