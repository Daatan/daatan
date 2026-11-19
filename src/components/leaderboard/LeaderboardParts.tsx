import type { ReactNode } from 'react'
import Link from 'next/link'
import { Bot, Medal, Newspaper, Trophy } from 'lucide-react'

// Shared by the user, source and AI-panel leaderboards so the three boards read as one surface.
// No hooks: the AI board is a server component.

export type Board = 'users' | 'ai' | 'sources'

const BOARDS: { board: Board; href: string; icon: typeof Trophy }[] = [
  { board: 'users', href: '/leaderboard', icon: Trophy },
  { board: 'ai', href: '/leaderboard/ai', icon: Bot },
  { board: 'sources', href: '/leaderboard/sources', icon: Newspaper },
]

/**
 * Switcher between the three boards, at the top of each (#2257). Underlined tabs rather than
 * pills: the sort and view rows below it are pills, and a third pill row read as one more filter.
 * On phones the three share the width without icons, so the longest locale (ru) fits at 360 px.
 */
export function BoardTabs({ active, labels, ariaLabel }: {
  active: Board
  labels: Record<Board, string>
  ariaLabel: string
}) {
  return (
    <nav aria-label={ariaLabel} className="flex border-b border-navy-600 mb-6 overflow-x-auto scrollbar-hide">
      {BOARDS.map(({ board, href, icon: Icon }) => (
        <Link
          key={board}
          href={href}
          aria-current={board === active ? 'page' : undefined}
          className={`-mb-px flex flex-1 sm:flex-none flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap border-b-2 px-2 sm:px-5 py-3 text-sm sm:text-base font-semibold transition-colors ${
            board === active
              ? 'border-cobalt text-white'
              : 'border-transparent text-gray-400 hover:border-navy-600 hover:text-white'
          }`}
        >
          <Icon className="hidden sm:block w-4 h-4" />
          {labels[board]}
        </Link>
      ))}
    </nav>
  )
}

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
 * `hidden`, not `invisible`: an invisible hint still counts toward the scroll size, so a short
 * table in an overflow-x-auto card (the sources board) would scroll vertically.
 */
export function ColumnHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none hidden group-hover:block group-has-[:focus-visible]:block absolute right-0 top-full z-20 mt-1 w-48 sm:w-64 rounded-lg border border-navy-600 bg-navy-800 p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-gray-300 shadow-lg"
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
