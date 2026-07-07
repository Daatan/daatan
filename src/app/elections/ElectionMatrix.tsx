'use client'

import type { ElectionMatrix as Matrix, ElectionCell, StanceSide } from '@/lib/elections/matrix'

const SIDE_STYLES: Record<StanceSide, string> = {
  yes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25',
  no: 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25',
  neutral: 'bg-slate-500/10 text-slate-400 border-slate-600/40 hover:bg-slate-500/20',
}

const SIDE_LABEL: Record<StanceSide, string> = { yes: 'כן', no: 'לא', neutral: 'מסויג' }

/** RTL-aware sticky first column: sticks to the row's start edge in either direction. */
const STICKY_START = 'sticky ltr:left-0 rtl:right-0 z-10 bg-[#0b1020]'

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

function Cell({ cell }: { cell: ElectionCell | undefined }) {
  if (!cell) {
    return (
      <td className="border border-slate-800/60 text-center align-middle">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-700" aria-hidden />
        <span className="sr-only">אין כיסוי</span>
      </td>
    )
  }
  const tooltip = [
    `${SIDE_LABEL[cell.side]}${cell.certainty != null ? ` · ודאות ${pct(cell.certainty)}` : ''}`,
    cell.claim ?? cell.title ?? '',
  ]
    .filter(Boolean)
    .join('\n')

  const inner = (
    <div className={`h-full w-full px-2 py-2 border ${SIDE_STYLES[cell.side]} transition-colors`}>
      <div className="text-[10px] font-black tracking-wider">{SIDE_LABEL[cell.side]}</div>
      <div className="text-[10px] opacity-70">{pct(cell.certainty)}</div>
    </div>
  )

  return (
    <td className="border border-slate-800/60 p-0 align-top" title={tooltip}>
      {cell.url ? (
        <a href={cell.url} target="_blank" rel="noopener noreferrer" className="block h-full">
          {inner}
        </a>
      ) : (
        inner
      )}
    </td>
  )
}

export function ElectionMatrix({ matrix }: { matrix: Matrix }) {
  const { events, authors } = matrix

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
        אין עדיין תחזיות המתויגות <span className="font-mono text-amber-300">בחירות 2026</span>. תייגו
        תחזיות בחירות והן יופיעו כאן כעמודות.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="border-collapse text-sm min-w-max">
        <thead>
          <tr>
            <th className={`${STICKY_START} border border-slate-800/60 px-3 py-3 text-start text-xs font-black tracking-widest text-slate-400 min-w-[180px]`}>
              פרשן
            </th>
            {events.map((e) => (
              <th
                key={e.id}
                className="border border-slate-800/60 px-2 py-3 align-bottom text-start font-semibold text-slate-200 max-w-[220px] min-w-[160px]"
                title={e.claimText}
              >
                <div className="line-clamp-3 text-xs leading-snug">{e.claimText}</div>
                {e.probabilityYes != null && (
                  <div className="mt-1 text-[10px] font-mono text-amber-300/80">אורקל: {e.probabilityYes}% כן</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {authors.map((a) => (
            <tr key={a.key}>
              <th scope="row" className={`${STICKY_START} border border-slate-800/60 px-3 py-2 text-start min-w-[180px]`}>
                <div className="font-bold text-slate-100">{a.nameHe}</div>
                <div className="text-[10px] text-slate-500">
                  {a.handle ? `@${a.handle}` : a.lang.toUpperCase()} · כיסה {a.coverage}
                </div>
              </th>
              {events.map((e) => (
                <Cell key={e.id} cell={a.cells[e.id]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
