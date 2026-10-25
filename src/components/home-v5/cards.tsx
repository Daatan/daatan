import Link from 'next/link'
import { CalendarDays, CircleX, CircleCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export interface ForecastCardData {
  tags: string[]
  statement: string
  /** The forecast's page; the statement links there. */
  href?: string
  resolutionNote?: string
  /** 0-100 */
  confidence: number
  resolvesOn: string
  open: boolean
}

export interface SourceCardData {
  name: string
  role?: string
  saidOn: string
  statement: string
  whatHappened: string
  verdict: 'correct' | 'wrong'
  tag: string
  /** Resolved calls in the tag, oldest first; true = correct. */
  record: boolean[]
}

const CARD = 'mt-9 flex flex-1 flex-col rounded-[14px] border border-[var(--hv5-panel)] bg-[var(--hv5-panel)] p-5 text-[var(--hv5-ink)] md:px-[30px] md:py-7'

export async function ForecastCard({ locale, data }: { locale: string; data: ForecastCardData }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5.card' })
  const pct = Math.max(0, Math.min(100, Math.round(data.confidence)))
  const C = 2 * Math.PI * 24
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="m-0 flex list-none gap-2 p-0">
          {data.tags.map((tag) => (
            <li key={tag} className="rounded-full border border-[#2c4f7c] px-3 py-[3px] text-sm leading-[1.4] text-[var(--hv5-accent-2)]">{tag}</li>
          ))}
        </ul>
        <span className="flex items-center gap-2 text-sm text-[var(--hv5-muted)]">
          <span aria-hidden="true" className="h-[9px] w-[9px] rounded-full border-[1.5px] border-[var(--hv5-accent-2)]" />
          {data.open ? t('statusOpen') : t('statusResolved')}
        </span>
      </div>
      <p className="mt-[22px] text-xl font-bold leading-[1.4] text-white md:text-2xl">
        {data.href ? (
          <Link href={data.href} className="text-white no-underline decoration-[var(--hv5-accent-2)] decoration-1 underline-offset-[5px] hover:underline">
            {data.statement}
          </Link>
        ) : (
          data.statement
        )}
      </p>
      {data.resolutionNote && <p className="mt-2.5 text-[15px] leading-[1.5] text-[var(--hv5-muted)]">{data.resolutionNote}</p>}
      <div className="mt-auto pt-7">
        <div className="flex flex-wrap gap-y-4 border-t border-[var(--hv5-line-2)] pt-[22px]">
          <div className="flex flex-1 items-center gap-3.5">
            <svg aria-hidden="true" width="52" height="52" viewBox="0 0 52 52" fill="none" className="shrink-0">
              <circle cx="26" cy="26" r="24" stroke="#24406A" strokeWidth="4" />
              <circle
                cx="26" cy="26" r="24" stroke="#7AA8DF" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${((C * pct) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 26 26)"
              />
            </svg>
            <div>
              <span className="block text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('confidence')}</span>
              <span className="block text-[22px] font-bold leading-[1.3] text-white">{pct}%</span>
            </div>
          </div>
          <div className="flex flex-1 items-center gap-3.5 border-[var(--hv5-line-2)] text-[var(--hv5-accent-2)] md:border-s md:ps-6">
            <CalendarDays className="h-[26px] w-[26px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <div>
              <span className="block text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('resolvesOn')}</span>
              <span className="block text-[22px] font-bold leading-[1.3] text-white">{data.resolvesOn}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase()
}

export async function SourceCard({ locale, data }: { locale: string; data: SourceCardData }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5.card' })
  const correct = data.record.filter(Boolean).length
  const ok = data.verdict === 'correct'
  return (
    <div className={CARD}>
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1b3a63] text-[17px] font-bold text-[#cfe0f5]">
          {initials(data.name)}
        </span>
        <div className="min-w-0">
          <span className="block text-lg font-bold leading-[1.3] text-white">{data.name}</span>
          {data.role && <span className="block text-[15px] leading-[1.4] text-[var(--hv5-muted)]">{data.role}</span>}
        </div>
      </div>
      <div className="mt-6">
        <span className="block text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('saidOn', { date: data.saidOn })}</span>
        <p className="mt-2 text-xl font-bold leading-[1.4] text-white md:text-[22px]">{data.statement}</p>
      </div>
      <div className="mt-[22px] grid grid-cols-1 gap-y-4 border-t border-[var(--hv5-line-2)] pt-[18px] md:grid-cols-2">
        <div className="md:pe-5">
          <span className="block text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('whatHappened')}</span>
          <p className="mt-1.5 text-[17px] leading-[1.45] text-[var(--hv5-body)]">{data.whatHappened}</p>
        </div>
        <div className="border-[var(--hv5-line-2)] md:border-s md:ps-5">
          <span className="block text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('verdict')}</span>
          <p className={`mt-1.5 flex items-center gap-2 text-xl font-bold leading-[1.3] ${ok ? 'text-[var(--hv5-ok)]' : 'text-[var(--hv5-bad)]'}`}>
            {ok ? <CircleCheck className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" /> : <CircleX className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />}
            <span>{ok ? t('correct') : t('wrong')}</span>
          </p>
        </div>
      </div>
      <div className="mt-auto pt-[22px]">
        <div className="border-t border-[var(--hv5-line-2)] pt-[18px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm leading-[1.4] text-[var(--hv5-muted)]">{t('recordIn', { tag: data.tag })}</span>
            <span className="text-base font-semibold text-[var(--hv5-ink)]">{t('recordCount', { correct, total: data.record.length })}</span>
          </div>
          <div aria-hidden="true" className="mt-3.5 flex flex-wrap items-center gap-[9px]">
            {data.record.map((r, i) => (
              <span
                key={i}
                className={`block h-3 w-3 shrink-0 rounded-full ${r ? 'bg-[var(--hv5-ok)]' : 'border-2 border-[var(--hv5-bad)]'} ${
                  i === data.record.length - 1
                    ? `ring-1 ring-offset-[3px] ring-offset-[var(--hv5-panel)] ${r ? 'ring-[var(--hv5-ok)]' : 'ring-[var(--hv5-bad)]'}`
                    : ''
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
