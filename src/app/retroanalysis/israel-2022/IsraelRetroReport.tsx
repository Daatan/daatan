'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import ScrollNav from '../ScrollNav'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, PollSeats, PoolRow, Region, ReportRow, Side } from './types'

const GROUPS: Group[] = ['polls', 'media', 'bloc', 'anti']
const GROUP_COLOR: Record<Group, string> = { polls: '#2a78d6', media: '#1baf7a', bloc: '#eb6834', anti: '#eda100' }
const REGIONS: Region[] = ['he', 'il_en', 'ru', 'ar', 'intl']
const SIDE_PILL: Record<Side, string> = {
  bloc61: 'bg-teal-50 text-teal-800',
  uncertain: 'bg-amber-50 text-amber-800',
  no61: 'bg-rose-50 text-rose-800',
}
// Event dates; the captions live in messages (retroIsrael.events, same order).
const EVENT_DATES = ['2022-06-20', '2022-06-30', '2022-07-10', '2022-08-14', '2022-09-15', '2022-10-11']
// Voice cards: the article numbers; name, role, quote and note live in messages (retroIsrael.hit / .miss).
const HIT = [203, 235, 275, 90]
const MISS = [37, 171, 285, 287]

interface Agg { n: number; p: number; y: number; u: number; no: number }
function agg(rs: PoolRow[]): Agg {
  const n = rs.length
  if (!n) return { n: 0, p: 0, y: 0, u: 0, no: 0 }
  return {
    n,
    p: rs.reduce((a, r) => a + r.p, 0) / n,
    y: rs.filter(r => r.s === 'bloc61').length / n,
    u: rs.filter(r => r.s === 'uncertain').length / n,
    no: rs.filter(r => r.s === 'no61').length / n,
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmtDay = (d: string) => { const [, m, dd] = d.split('-'); return `${Number(dd)}.${m}` }
const DAY = 864e5
const T0 = Date.parse('2022-05-01')
const T1 = Date.parse('2022-11-01')

export default function IsraelRetroReport({ rows, pool, polls }: { rows: ReportRow[]; pool: PoolRow[]; polls: PollSeats[] }) {
  const t = useTranslations('retroIsrael')
  const locale = useLocale()
  const groupName = (g: Group) => t(`group.${g}`)
  const byGroup = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, agg(pool.filter(r => r.g === g))])) as Record<Group, Agg>, [pool])
  const byRegion = useMemo(() => Object.fromEntries(REGIONS.map(k => [k, agg(pool.filter(r => r.r === k))])) as Record<Region, Agg>, [pool])
  const byN = useMemo(() => new Map(rows.map(r => [r.n, r])), [rows])
  const unverified = rows.filter(r => !r.quote_verified).length

  const oct = polls.filter(r => r.d >= '2022-10-01')
  const octUnder = oct.filter(r => r.s < 61).length / Math.max(1, oct.length)
  const thesis: [Group, string, string, string, number, string][] = [
    ['polls', pct(octUnder), t('thesis.polls.unit'), t('thesis.polls.text'), oct.length, t('thesis.polls.metric')],
    ['media', pct(byGroup.media.p), t('thesis.media.unit'), t('thesis.media.text', { no: pct(byGroup.media.no), yes: pct(byGroup.media.y) }), byGroup.media.n, t('thesis.media.metric')],
    ['bloc', pct(byGroup.bloc.y), t('thesis.bloc.unit'), t('thesis.bloc.text'), byGroup.bloc.n, t('thesis.bloc.metric')],
    ['anti', pct(byGroup.anti.no), t('thesis.anti.unit'), t('thesis.anti.text', { p: pct(byGroup.anti.p) }), byGroup.anti.n, t('thesis.anti.metric')],
  ]
  const hl = (c: React.ReactNode) => <b className="text-rose-700 font-medium">{c}</b>

  return (
    <div className="retro-light min-h-screen bg-[#f5f7fa] text-gray-800">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link href="/retroanalysis" className="text-xs font-bold tracking-widest uppercase text-gray-500 hover:text-gray-700">{t('back')}</Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono uppercase tracking-widest text-gray-600">
            <span>{t('caseLabel')}</span><span>{t.rich('window', { hl })}</span>
          </div>
          <h1 className="mt-4 text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-[1.05]">
            {t.rich('h1', { hl: c => <span className="text-rose-700">{c}</span> })}
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-gray-700 leading-relaxed">
            {t('lead', { count: pool.length.toLocaleString(locale) })}
          </p>
          <p className="mt-3 max-w-2xl text-sm text-gray-600 leading-relaxed">
            {t('ratingsNote')}
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t-2 border-gray-900 border-b border-gray-200">
            {thesis.map(([g, big, unit, text, n, metric], i) => (
              <div key={g} className={`py-5 pe-5 ${i > 0 ? 'lg:ps-5 lg:border-s border-gray-200' : ''} ${i > 0 ? 'border-t sm:border-t-0' : ''} ${i === 1 || i === 3 ? 'sm:ps-5 sm:border-s' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''}`}>
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GROUP_COLOR[g] }} />{groupName(g)}
                </div>
                <div className="mt-2 text-4xl font-black text-gray-900 tabular-nums">{big}<span className="ms-1.5 text-sm font-normal text-gray-600">{unit}</span></div>
                <div className="mt-1 font-mono text-[11px] text-gray-600">{t('nStat', { n: n.toLocaleString(locale) })} · {metric}</div>
                <p className="mt-2 text-sm text-gray-700 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </header>

        <NumbersGuide />

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('polls.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('polls.intro')}</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <PollChart polls={polls} />
          </div>
          <p className="mt-3 text-xs text-gray-600">{t('polls.foot', { count: polls.length })}</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('trend.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('trend.intro')}</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-gray-700 mb-2">
              {GROUPS.map(g => (
                <span key={g} className="inline-flex items-center gap-2"><i className="w-3.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{groupName(g)} <span className="font-mono text-gray-500">{byGroup[g].n}</span></span>
              ))}
              <span className="inline-flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-gray-400/60" />{t('trend.oneArticle')}</span>
            </div>
            <TrendChart pool={pool} />
            <ol className="mt-4 grid gap-x-6 gap-y-1.5 text-[13px] text-gray-700" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
              {EVENT_DATES.map((d, i) => (
                <li key={d} className="flex gap-2.5 items-baseline">
                  <b className="flex-none inline-grid place-items-center w-5 h-5 rounded-full border border-gray-500 font-mono text-[11px] font-medium">{i + 1}</b>
                  <span><span className="font-mono text-xs text-gray-500">{fmtDay(d)}</span> {t(`events.${i}`)}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-xs text-gray-600">{t('trend.foot', { count: pool.length })}</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('voices.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('voices.intro')}</p>
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <VoiceColumn title={t('voices.hit')} range="P ≥ 0.6" tone="hit" voices={HIT} byN={byN} />
            <VoiceColumn title={t('voices.miss')} range="P ≤ 0.25" tone="miss" voices={MISS} byN={byN} />
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('split.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('split.intro')}</p>
          <div className="mt-6 grid gap-x-4 gap-y-3 items-center" style={{ gridTemplateColumns: 'minmax(140px,230px) 1fr 64px' }}>
            <SplitHeader label={t('split.byVoice')} />
            {GROUPS.map(g => <SplitRow key={g} label={groupName(g)} a={byGroup[g]} />)}
            <SplitHeader label={t('split.byLang')} />
            {REGIONS.map(k => <SplitRow key={k} label={t(`region.${k}`)} a={byRegion[k]} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-700">
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-teal-600" />{t('split.legendYes')}</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-gray-300" />{t('split.legendUnsure')}</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-rose-600" />{t('split.legendNo')}</span>
            <span className="font-mono text-gray-500">{t('split.legendRight')}</span>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('table.h', { count: rows.length })}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t.rich('table.intro', { a: c => <a href="#numbers" className="underline">{c}</a> })}</p>
          {locale !== 'en' && <p className="mt-2 max-w-2xl text-sm text-gray-600">{t('table.langNote')}</p>}
          <ArticleTable rows={rows} />
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('method.h')}</h2>
          <div className="mt-5 grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <Method title={t('method.searchT')}>{t('method.search')}</Method>
            <Method title={t('method.filterT')}>{t('method.filter')}</Method>
            <Method title={t('method.ratingT')} formula={t('numbers.formulaShort')}>{t('method.rating')}</Method>
          </div>
          <h3 className="mt-10 text-lg font-extrabold text-gray-900">{t('method.missingH')}</h3>
          <ul className="mt-2 list-disc ps-5 space-y-1.5 text-gray-700 max-w-3xl">
            <li>{t('method.m1')}</li>
            <li>{t('method.m2')}</li>
            <li>{t('method.m3')}</li>
            <li>{t('method.m4', { unverified, total: rows.length })}</li>
            <li>{t('method.m5')}</li>
          </ul>
        </section>

        <div className="mt-16 text-center text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">{t('footer')}</div>
      </div>
      <ScrollNav />
    </div>
  )
}

function NumbersGuide() {
  const t = useTranslations('retroIsrael')
  const b = (c: React.ReactNode) => <b className="text-gray-900">{c}</b>
  const scaleMarks: [number, string][] = [
    [0.15, t('miss.171.name')],
    [0.3, t('numbers.poll', { n: 59 })],
    [0.5, t('numbers.coin')],
    [0.65, t('numbers.poll', { n: 61 })],
    [0.82, t('hit.203.name')],
  ]
  return (
    <section id="numbers" className="mt-12 scroll-mt-6">
      <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('numbers.h')}</h2>
      <p className="mt-2 max-w-2xl text-gray-700">{t.rich('numbers.intro', { b })}</p>
      <div className="mt-6 max-w-3xl">
        <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
          <div className="flex items-baseline gap-3"><span className="text-3xl font-black text-gray-900">P</span><span className="text-sm text-gray-600">{t('numbers.range')}</span></div>
          <p className="mt-3 text-[15px] text-gray-700 leading-relaxed">{t.rich('numbers.def', { b })}</p>
          <div dir="ltr" className="relative mt-14 mb-12 mx-2">
            <div className="h-2 rounded-full bg-gradient-to-r from-rose-500 via-gray-300 to-teal-600" />
            {scaleMarks.map(([p, who], i) => (
              <div key={who} className={`absolute flex flex-col w-40 whitespace-nowrap ${p < 0.15 ? '-translate-x-[6px] items-start text-left' : p > 0.85 ? '-translate-x-[calc(100%-6px)] items-end text-right' : '-translate-x-1/2 items-center text-center'} ${i % 2 ? 'top-3' : 'bottom-3 flex-col-reverse'}`} style={{ left: `${p * 100}%` }}>
                <span className="w-px h-2.5 bg-gray-500" />
                <span className="font-mono text-[11px] text-gray-900 font-medium">{p.toFixed(2)} {who}</span>
              </div>
            ))}
            <span className="absolute -left-2 top-3 font-mono text-[11px] text-gray-500">0</span>
            <span className="absolute -right-2 top-3 font-mono text-[11px] text-gray-500">1</span>
          </div>
          <ul className="space-y-1.5 text-[14px] text-gray-700 leading-relaxed list-disc ps-5">
            <li>{t.rich('numbers.b1', { m: c => <span dir="ltr" className="font-mono text-gray-900">{c}</span> })}</li>
            <li>{t('numbers.b2')}</li>
            <li>{t.rich('numbers.b3', { b })}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function Method({ title, formula, children }: { title: string; formula?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-[15px] text-gray-700 leading-relaxed">{children}</p>
      {formula && <div className="mt-2 inline-block font-mono text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900">{formula}</div>}
    </div>
  )
}

function SplitHeader({ label }: { label: string }) {
  return <div className="col-span-3 pt-3 text-[11px] font-mono uppercase tracking-widest text-gray-500">{label}</div>
}

function SplitRow({ label, a }: { label: string; a: Agg }) {
  const t = useTranslations('retroIsrael')
  const seg = (cls: string, v: number, text: string) => v > 0 && (
    <span className={`flex items-center justify-center overflow-hidden whitespace-nowrap font-mono text-xs font-medium first:rounded-l last:rounded-r ${cls}`} style={{ flex: v }} title={`${text} ${pct(v)}`}>{v >= 0.09 ? pct(v) : ''}</span>
  )
  return (
    <>
      <div className="text-sm leading-tight">{label}<span className="block font-mono text-xs text-gray-500">{t('split.articles', { n: a.n })}</span></div>
      <div className="flex h-6 gap-[2px]" role="img" aria-label={t('split.aria', { label, y: pct(a.y), u: pct(a.u), no: pct(a.no) })}>
        {seg('bg-teal-600 text-white', a.y, t('split.expects'))}
        {seg('bg-gray-300 text-gray-800', a.u, t('split.unsure'))}
        {seg('bg-rose-600 text-white', a.no, t('split.doesNot'))}
      </div>
      <div className="text-right font-mono text-[15px] font-medium tabular-nums">{a.p.toFixed(2)}<span className="block text-[11px] text-gray-500">{t('split.meanP')}</span></div>
    </>
  )
}

function VoiceColumn({ title, range, tone, voices, byN }: { title: string; range: string; tone: 'hit' | 'miss'; voices: number[]; byN: Map<number, ReportRow> }) {
  const t = useTranslations('retroIsrael')
  const color = tone === 'hit' ? 'text-teal-700 border-teal-700' : 'text-rose-700 border-rose-700'
  return (
    <div>
      <div className={`flex items-baseline justify-between border-b-2 pb-1.5 ${color}`}>
        <h3 className="text-lg font-extrabold">{title}</h3><span className="font-mono text-xs">{range}</span>
      </div>
      {voices.map(n => {
        const r = byN.get(n)
        if (!r) return null
        const vk = `${tone}.${n}`
        return (
          <article key={n} className="grid grid-cols-[64px_1fr] gap-x-4 py-4 border-b border-gray-200">
            <div className={`row-span-3 text-2xl font-black tabular-nums ${tone === 'hit' ? 'text-teal-700' : 'text-rose-700'}`}>
              {r.p61.toFixed(2)}
              <span className="block mt-1 font-mono text-[10px] font-normal text-gray-500">{t('voices.p61')}</span>
            </div>
            <div className="font-mono text-xs text-gray-500">{r.date.split('-').reverse().join('.')} · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">{r.domain}</a></div>
            <div className="font-bold text-gray-900 leading-snug">{t(`${vk}.name`)}<span className="block font-normal text-sm text-gray-600">{t(`${vk}.role`)}</span></div>
            <div>
              <blockquote className="mt-1.5 italic text-gray-800 leading-relaxed">“{t(`${vk}.quote`)}”</blockquote>
              <p className="mt-1.5 text-sm text-gray-600">{t(`${vk}.note`)}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

interface Tip { x: number; y: number; i: number }

function TrendChart({ pool }: { pool: PoolRow[] }) {
  const t = useTranslations('retroIsrael')
  const locale = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(300, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const days = useMemo(() => {
    const out: number[] = []
    for (let t = Date.parse('2022-05-10'); t <= Date.parse('2022-10-31'); t += DAY) out.push(t)
    return out
  }, [])
  const pts = useMemo(() => pool.map(r => ({ ...r, t: Date.parse(r.d) })), [pool])
  const roll = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, days.map(t => {
    const w = pts.filter(r => r.g === g && r.t <= t && r.t > t - 14 * DAY)
    return w.length >= 5 ? w.reduce((a, r) => a + r.p, 0) / w.length : null
  })])) as Record<Group, (number | null)[]>, [pts, days])
  const jitter = useMemo(() => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    return pts.map(() => [(rnd() - 0.5) * 4, (rnd() - 0.5) * 6])
  }, [pts])

  const narrow = width < 640
  const W = width, H = narrow ? 380 : 440, L = 38, R = narrow ? 96 : 124, T = 34, B = 26
  const x = (t: number) => L + (t - T0) / (T1 - T0) * (W - L - R)
  const y = (p: number) => T + (1 - p) * (H - T - B)

  const paths = GROUPS.map(g => {
    let d = '', pen = false
    roll[g].forEach((m, i) => {
      if (m == null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(days[i]).toFixed(1)},${y(m).toFixed(1)}`
      pen = true
    })
    const lastIdx = roll[g].map((m, i) => (m == null ? -1 : i)).filter(i => i >= 0).pop() ?? 0
    return { g, d, last: roll[g][lastIdx] ?? 0 }
  })
  const labels = [...paths].map(p => ({ g: p.g, m: p.last, ly: y(p.last) })).sort((a, b) => a.ly - b.ly)
  for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 16) labels[i].ly = labels[i - 1].ly + 16

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const rc = svg.getBoundingClientRect()
    const px = (e.clientX - rc.left) * W / rc.width
    const t = T0 + (px - L) / (W - L - R) * (T1 - T0)
    const i = Math.max(0, Math.min(days.length - 1, Math.round((t - days[0]) / DAY)))
    setTip({ x: e.clientX, y: e.clientY, i })
  }

  const monthName = (iso: string) => new Date(`${iso}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const months: [string, string][] = ['2022-06', '2022-07', '2022-08', '2022-09', '2022-10'].map(m => [`${m}-01`, monthName(m)])
  const hx = tip ? x(days[tip.i]) : 0

  return (
    <div ref={box} dir="ltr" className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={t('trend.aria')}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={L} x2={x(T1)} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? '#6b7280' : '#eceff3'} strokeDasharray={p === 0.5 ? '3 4' : undefined} />
              <text x={L - 8} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
            </g>
          ))}
          <text x={x(T0) + 4} y={H - 6}>{monthName('2022-05')}</text>
          {months.map(([d, l]) => (
            <g key={d}>
              <line x1={x(Date.parse(d))} x2={x(Date.parse(d))} y1={T} y2={H - B} stroke="#eceff3" />
              <text x={x(Date.parse(d)) + 4} y={H - 6}>{l}</text>
            </g>
          ))}
          {EVENT_DATES.map((d, i) => {
            const X = x(Date.parse(d))
            return (
              <g key={d}>
                <line x1={X} x2={X} y1={T - 6} y2={H - B} stroke="#d7dde3" strokeDasharray="2 3" />
                <circle cx={X} cy={T - 16} r={9} fill="#fff" stroke="#4b5563" />
                <text x={X} y={T - 12.5} textAnchor="middle" fontSize={10.5} fill="#374151" fontWeight={500}>{i + 1}</text>
              </g>
            )
          })}
        </g>
        {pts.map((r, i) => (
          <circle key={i} cx={x(r.t) + jitter[i][0]} cy={y(r.p) + jitter[i][1]} r={narrow ? 1.8 : 2.3} fill={GROUP_COLOR[r.g]} fillOpacity={0.28} />
        ))}
        {paths.map(({ g, d }) => (
          <g key={g}>
            <path d={d} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" />
            <path d={d} fill="none" stroke={GROUP_COLOR[g]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        <line x1={x(T1)} x2={x(T1)} y1={T - 6} y2={H - B} stroke="#be123c" strokeWidth={1.5} />
        <text x={x(T1)} y={H - 6} textAnchor="middle" className="font-mono" fontSize={11.5} fill="#be123c" fontWeight={500}>{t('trend.election')}</text>
        {labels.map(l => (
          <text key={l.g} x={x(T1) + 6} y={l.ly + 4} fontSize={narrow ? 11 : 12.5} fontWeight={700} fill={GROUP_COLOR[l.g]}>{t(`groupShort.${l.g}`)} {Math.round(l.m * 100)}%</text>
        ))}
        {tip && (
          <g>
            <line x1={hx} x2={hx} y1={T} y2={H - B} stroke="#374151" />
            {GROUPS.map(g => {
              const m = roll[g][tip.i]
              return m == null ? null : <circle key={g} cx={hx} cy={y(m)} r={4.5} fill={GROUP_COLOR[g]} stroke="#fff" strokeWidth={2} />
            })}
          </g>
        )}
        <rect x={L} y={T} width={x(T1) - L} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setTip(null)} />
      </svg>
      {tip && <ChartTip tip={tip} day={days[tip.i]} roll={roll} />}
    </div>
  )
}

function ChartTip({ tip, day, roll }: { tip: Tip; day: number; roll: Record<Group, (number | null)[]> }) {
  const t = useTranslations('retroIsrael')
  const locale = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: tip.x + 16, top: tip.y + 16 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let left = tip.x + 16, top = tip.y + 16
    if (left + el.offsetWidth > window.innerWidth - 8) left = tip.x - el.offsetWidth - 16
    if (top + el.offsetHeight > window.innerHeight - 8) top = tip.y - el.offsetHeight - 16
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [tip.x, tip.y])
  const sorted = [...GROUPS].sort((a, b) => (roll[b][tip.i] ?? -1) - (roll[a][tip.i] ?? -1))
  const date = new Date(day).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div ref={ref} className="fixed z-20 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-[13px] min-w-[240px]" style={pos}>
      <div className="font-mono text-xs text-gray-600 mb-1.5">{t('trend.tip', { date, days: Math.round((T1 - day) / DAY) })}</div>
      {sorted.map(g => {
        const m = roll[g][tip.i]
        return (
          <div key={g} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-gray-700"><i className="w-2.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{t(`group.${g}`)}</span>
            <b className={`font-mono font-medium tabular-nums ${m == null ? 'text-gray-500' : ''}`}>{m == null ? t('trend.few') : pct(m)}</b>
          </div>
        )
      })}
    </div>
  )
}

const NO61_KINDS = ['deadlock', 'opposition_forms_govt', 'unity_govt', 'unclear']

type SortKey = 'n' | 'date' | 'voice_name' | 'p61' | 'projected_bloc_seats'

function ArticleTable({ rows }: { rows: ReportRow[] }) {
  const t = useTranslations('retroIsrael')
  const groupName = (g: Group) => t(`group.${g}`)
  const [fGroup, setFGroup] = useState('')
  const [fSide, setFSide] = useState('')
  const [fReg, setFReg] = useState('')
  const [q, setQ] = useState('')
  const [sortK, setSortK] = useState<SortKey>('date')
  const [dir, setDir] = useState(1)

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const rs = rows.filter(r => (!fGroup || r.g === fGroup) && (!fSide || r.side === fSide) && (!fReg || r.reg === fReg) &&
      (!qq || [r.title, r.domain, r.voice_name, r.voice_affiliation, r.summary, r.key_quote, r.key_quote_en].join(' ').toLowerCase().includes(qq)))
    return [...rs].sort((a, b) => {
      const A = a[sortK] ?? '', B = b[sortK] ?? ''
      return (A > B ? 1 : A < B ? -1 : 0) * dir
    })
  }, [rows, fGroup, fSide, fReg, q, sortK, dir])

  const sortBy = (k: SortKey) => {
    if (k === sortK) setDir(-dir)
    else { setSortK(k); setDir(k === 'p61' ? -1 : 1) }
  }
  const th = (k: SortKey, label: string, right = false, sub?: string) => (
    <th className={`sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600 whitespace-nowrap ${right ? 'text-end' : 'text-start'}`}
      aria-sort={sortK === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)} className="uppercase">{label}{sortK === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>{sub && <span className="block normal-case tracking-normal font-sans text-[11px] font-normal text-gray-500">{sub}</span>}
    </th>
  )
  const sel = 'bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-sm text-gray-800 min-w-[150px]'
  const lbl = 'flex flex-col gap-1 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600'

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className={lbl}>{t('table.voice')}<select className={sel} value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">{t('table.all')}</option>{GROUPS.map(g => <option key={g} value={g}>{groupName(g)}</option>)}</select></label>
        <label className={lbl}>{t('table.position')}<select className={sel} value={fSide} onChange={e => setFSide(e.target.value)}><option value="">{t('table.all')}</option><option value="bloc61">{t('side.bloc61')}</option><option value="uncertain">{t('side.uncertain')}</option><option value="no61">{t('side.no61')}</option></select></label>
        <label className={lbl}>{t('table.outlet')}<select className={sel} value={fReg} onChange={e => setFReg(e.target.value)}><option value="">{t('table.all')}</option>{REGIONS.map(k => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></label>
        <label className={lbl}>{t('table.search')}<input type="search" className={`${sel} min-w-[210px]`} placeholder={t('table.placeholder')} value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="ms-auto font-mono text-xs text-gray-600">{t('table.shown', { shown: shown.length, total: rows.length })}</span>
      </div>
      {/* Phones get stacked cards: the 7-column table needs ~1100px and made readers scroll sideways (daatan#1779). */}
      <ul className="md:hidden space-y-3">
        {shown.map(r => (
          <li key={r.n} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 font-mono text-xs text-gray-600">
              <span>#{r.n} · {r.date}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${SIDE_PILL[r.side]}`}>{r.p61.toFixed(2)} {t(`side.${r.side}`)}</span>
            </div>
            <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="mt-2 block font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
            <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ` · ${t('table.archived')}` : ''}</div>
            <div className="mt-2 text-sm text-gray-800">
              <span className="inline-block w-2 h-2 rounded-sm me-1.5" style={{ background: GROUP_COLOR[r.g] }} title={groupName(r.g)} />
              {r.voice_name || '—'}{r.voice_affiliation && <span className="text-gray-600"> · {r.voice_affiliation}</span>}
            </div>
            <div className="mt-1 font-mono text-xs text-gray-600">{t('table.seatsLine', { seats: r.projected_bloc_seats ?? '—' })}{r.side === 'no61' && r.no61_kind && NO61_KINDS.includes(r.no61_kind) ? ` · ${t(`no61kind.${r.no61_kind}`)}` : ''} · {t('table.confidence', { c: (r.claim_strength ?? 0).toFixed(2) })}</div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-gray-700 leading-snug">{r.summary}</summary>
              <blockquote className="mt-2 ps-2.5 border-s-2 border-gray-200 italic text-[13px] text-gray-800">
                {r.key_quote_en}
                {r.key_quote && r.key_quote !== r.key_quote_en && <span dir="auto" className="block mt-1 text-gray-500">{r.key_quote}</span>}
              </blockquote>
              {!r.quote_verified && <div className="mt-1 font-mono text-[11px] text-amber-700">{t('table.notVerbatim')}</div>}
            </details>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead><tr>
            {th('n', '#', true)}{th('date', t('table.date'))}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600 text-start">{t('table.article')}</th>
            {th('voice_name', t('table.mainVoice'), false, t('table.mainVoiceSub'))}{th('p61', t('table.p61'))}{th('projected_bloc_seats', t('table.blocSeats'), true)}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600 text-start">{t('table.summary')}</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.n} className="align-top border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.n}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2.5 min-w-[240px] max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
                  <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ` · ${t('table.archived')}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                  <span className="inline-block w-2 h-2 rounded-sm me-1.5" style={{ background: GROUP_COLOR[r.g] }} title={groupName(r.g)} />
                  {r.voice_name || '—'}<span className="block text-xs text-gray-500 leading-snug">{r.voice_affiliation}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="relative w-16 h-1.5 bg-gray-100 rounded"><span className="absolute inset-y-0 left-0 rounded bg-gray-700" style={{ width: `${r.p61 * 100}%` }} /><span className="absolute -inset-y-0.5 left-1/2 w-px bg-gray-400" /></span>
                    <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${SIDE_PILL[r.side]}`}>{r.p61.toFixed(2)} {t(`side.${r.side}`)}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-gray-500">{t('table.confidence', { c: (r.claim_strength ?? 0).toFixed(2) })}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.projected_bloc_seats ?? '—'}<div className="font-sans text-xs text-gray-500">{r.side === 'no61' && r.no61_kind && NO61_KINDS.includes(r.no61_kind) ? t(`no61kind.${r.no61_kind}`) : ''}</div></td>
                <td className="px-3 py-2.5 min-w-[260px] max-w-[420px]">
                  <details>
                    <summary className="cursor-pointer text-[13px] text-gray-700 leading-snug">{r.summary}</summary>
                    <blockquote className="mt-2 ps-2.5 border-s-2 border-gray-200 italic text-[13px] text-gray-800">
                      {r.key_quote_en}
                      {r.key_quote && r.key_quote !== r.key_quote_en && <span dir="auto" className="block mt-1 text-gray-500">{r.key_quote}</span>}
                    </blockquote>
                    {!r.quote_verified && <div className="mt-1 font-mono text-[11px] text-amber-700">{t('table.notVerbatim')}</div>}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const MONTH_KEYS = ['2022-05', '2022-06', '2022-07', '2022-08', '2022-09', '2022-10']
const S0 = 55, S1 = 66

function PollChart({ polls }: { polls: PollSeats[] }) {
  const t = useTranslations('retroIsrael')
  const locale = useLocale()
  const MONTHS: [string, string][] = MONTH_KEYS.map(m => [m, new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })])
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(300, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { cnt, max, med } = useMemo(() => {
    const cnt = new Map<string, number>()
    let max = 1
    for (const r of polls) {
      const k = `${r.d.slice(0, 7)}|${Math.max(S0, Math.min(S1, r.s))}`
      const c = (cnt.get(k) ?? 0) + 1
      cnt.set(k, c)
      max = Math.max(max, c)
    }
    const med = Object.fromEntries(MONTHS.map(([m]) => {
      const v = polls.filter(r => r.d.startsWith(m)).map(r => r.s).sort((a, b) => a - b)
      return [m, v[Math.floor(v.length / 2)]]
    }))
    return { cnt, max, med }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- MONTHS is derived from the constant MONTH_KEYS
  }, [polls])

  const narrow = width < 560
  const W = width, L = narrow ? 40 : 54, R = 14, T = 30, rowH = narrow ? 34 : 40, H = T + MONTHS.length * rowH + 30
  const x = (v: number) => L + (v - S0 + 0.5) / (S1 - S0 + 1) * (W - L - R)
  const y = (i: number) => T + i * rowH + rowH / 2
  const rMax = Math.min(rowH / 2 - 2, (W - L - R) / (S1 - S0 + 1) / 2 - 1)
  const seatLabel = (v: number) => (v === S0 ? `≤${v}` : v === S1 ? `≥${v}` : `${v}`)
  const seats = Array.from({ length: S1 - S0 + 1 }, (_, i) => S0 + i)

  return (
    <div ref={box} dir="ltr" className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={t('polls.aria')}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          {seats.filter(v => !narrow || v % 2 === 1).map(v => <text key={v} x={x(v)} y={H - 8} textAnchor="middle">{seatLabel(v)}</text>)}
          <line x1={x(60.5)} x2={x(60.5)} y1={T - 10} y2={H - 24} stroke="#4b5563" strokeDasharray="4 4" />
          <text x={x(60.5) - 4} y={T - 14} textAnchor="end">{t('polls.noMajority', { lt: '<' })}</text>
          <line x1={x(64)} x2={x(64)} y1={T - 10} y2={H - 24} stroke="#be123c" strokeWidth={2} />
          <text x={x(64) + 5} y={T - 14} fill="#be123c" fontWeight={500}>{t('polls.result')}</text>
          {MONTHS.map(([m, l], i) => (
            <g key={m}>
              <line x1={L} x2={W - R} y1={y(i)} y2={y(i)} stroke="#eceff3" />
              <text x={L - 8} y={y(i) + 4} textAnchor="end" fill="#374151">{l}</text>
            </g>
          ))}
        </g>
        {MONTHS.flatMap(([m, l], i) => seats.map(v => {
          const c = cnt.get(`${m}|${v}`)
          if (!c) return null
          const text = t('polls.tip', { month: l, c, seats: seatLabel(v), med: med[m] })
          const show = (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, text })
          return (
            <circle key={`${m}${v}`} cx={x(v)} cy={y(i)} r={Math.max(3, rMax * Math.sqrt(c / max))} fill={v >= 61 ? '#be123c' : '#2a78d6'} fillOpacity={0.75} stroke="#fff" strokeWidth={2}
              onPointerMove={show} onPointerDown={show} onPointerLeave={() => setTip(null)} />
          )
        }))}
      </svg>
      {tip && <div className="fixed z-20 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 font-mono text-xs text-gray-700" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  )
}
