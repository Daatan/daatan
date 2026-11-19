import type { ReactNode } from 'react'
import { Medal } from 'lucide-react'

// Shared by the user, source and AI-panel leaderboards so the three boards read as one surface.
// No hooks: the AI board is a server component.

export const TABLE_CARD = 'bg-navy-700 border border-navy-600 rounded-2xl shadow-sm'
export const HEAD_ROW = 'bg-navy-800 border-b border-navy-600'
export const HEAD_CELL = 'py-4 text-[10px] sm:text-xs font-bold uppercase tracking-normal sm:tracking-wider'
export const BODY = 'divide-y divide-gray-100/10'

/** Lower Brier is better. 0.25 is a coin flip; colour by how far below that a score is. */
export function brierTone(brier: number): string {
  if (brier <= 0.1) return 'text-emerald-400'
  if (brier <= 0.2) return 'text-lime-400'
  if (brier < 0.25) return 'text-yellow-400'
  return 'text-red-400'
}

/** The active column's figure is the one the board is ranked by, so it reads largest. */
export const valueSize = (active: boolean) => (active ? 'font-black text-base sm:text-lg' : 'font-bold text-sm')

export const pillClass = (active: boolean) =>
  active ? 'bg-blue-600 text-white' : 'bg-navy-700 text-gray-400 hover:bg-navy-600'

/** 0-based rank: medals for the top three, the number after that. */
export function RankBadge({ rank }: { rank: number }) {
  switch (rank) {
    case 0: return <Medal className="w-6 h-6 text-yellow-500" />
    case 1: return <Medal className="w-6 h-6 text-gray-400" />
    case 2: return <Medal className="w-6 h-6 text-amber-600" />
    default: return <span className="text-lg font-bold text-gray-400 w-6 text-center">{rank + 1}</span>
  }
}

/**
 * Column hint. The enclosing <th> needs `relative group`. Shown on hover and on keyboard focus
 * inside the header; on touch screens a tap triggers hover, so it appears with the tap.
 */
export function ColumnHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100 transition-opacity absolute right-0 top-full z-20 mt-1 w-48 sm:w-64 rounded-lg border border-navy-600 bg-navy-800 p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-gray-300 shadow-lg"
    >
      {children}
    </span>
  )
}

/** Visible under a header whose metric is lower-is-better, so the direction needs no hover. */
export function LowerIsBetter({ label }: { label: string }) {
  return (
    <span className="hidden sm:block text-[10px] font-medium normal-case tracking-normal text-gray-500">
      {label}
    </span>
  )
}

export function LegendCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="p-4 bg-navy-800 rounded-xl border border-navy-600">
      <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      <p className="text-xs text-gray-500 leading-relaxed">{children}</p>
    </div>
  )
}

export const LEGEND_GRID = 'mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
