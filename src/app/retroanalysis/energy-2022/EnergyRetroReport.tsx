'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import ScrollNav from '../ScrollNav'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, Leg, PoolRow, PriceSeries, Prices, Region, ReportRow, Side } from './types'

const GROUPS: Group[] = ['banks', 'agencies', 'insiders', 'press']
const GROUP_COLOR: Record<Group, string> = { banks: '#2a78d6', agencies: '#1baf7a', insiders: '#eb6834', press: '#eda100' }
const REGIONS: Region[] = ['en', 'ru', 'eu', 'ar']
const LEG_FIELD: Record<Leg, 'pb' | 'pt'> = { brent: 'pb', ttf: 'pt' }
const THRESHOLD: Record<Leg, number> = { brent: 120, ttf: 200 }
const THRESHOLD_LABEL: Record<Leg, string> = { brent: '$120', ttf: '€200' }
const SIDE_PILL: Record<Side, string> = {
  high: 'bg-teal-50 text-teal-800',
  uncertain: 'bg-amber-50 text-amber-800',
  low: 'bg-rose-50 text-rose-800',
}

// Voice cards: the article numbers; name, role and note live in messages (retroEnergy.cards.<leg>.<tone>.<n>).
const CARDS: Record<Leg, { hit: number[]; miss: number[] }> = {
  brent: { hit: [160, 206], miss: [120, 152] },
  ttf: { hit: [8, 164], miss: [167, 5] },
}

interface Agg { n: number; p: number; y: number; u: number; no: number }
function agg(rs: PoolRow[], leg: Leg): Agg {
  const f = LEG_FIELD[leg]
  const v = rs.map(r => r[f]).filter((x): x is number => x != null)
  const n = v.length
  if (!n) return { n: 0, p: 0, y: 0, u: 0, no: 0 }
  return {
    n,
    p: v.reduce((a, x) => a + x, 0) / n,
    y: v.filter(x => x >= 0.6).length / n,
    u: v.filter(x => x > 0.4 && x < 0.6).length / n,
    no: v.filter(x => x <= 0.4).length / n,
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const sideOf = (p: number): Side => (p >= 0.6 ? 'high' : p <= 0.4 ? 'low' : 'uncertain')
const DAY = 864e5
const T0 = Date.parse('2021-09-01')
const TW = Date.parse('2022-02-24')
const T1 = Date.parse('2022-12-31')
const ROLL = 30 * DAY
const MONTH_TICKS: number[] = (() => {
  const out: number[] = []
  for (let y = 2021, m = 8; ; ) {
    const t = Date.UTC(y, m, 1)
    if (t > T1) break
    out.push(t)
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return out
})()
const monthLabel = (locale: string, t: number) => new Date(t).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
const LEGS: Leg[] = ['brent', 'ttf']

export default function EnergyRetroReport({ rows, pool, prices }: { rows: ReportRow[]; pool: PoolRow[]; prices: Prices }) {
  const t = useTranslations('retroEnergy')
  const locale = useLocale()
  const groupName = (g: Group) => t(`group.${g}`)
  const total = useMemo(() => Object.fromEntries(LEGS.map(l => [l, agg(pool, l)])) as Record<Leg, Agg>, [pool])
  const agencyOil = useMemo(() => agg(pool.filter(r => r.g === 'agencies'), 'brent'), [pool])
  const pressGas = useMemo(() => agg(pool.filter(r => r.g === 'press'), 'ttf'), [pool])
  const bankGas = useMemo(() => agg(pool.filter(r => r.g === 'banks'), 'ttf').n, [pool])
  const agencyGas = useMemo(() => agg(pool.filter(r => r.g === 'agencies'), 'ttf').n, [pool])
  const byN = useMemo(() => new Map(rows.map(r => [r.n, r])), [rows])
  const unverified = rows.filter(r => !r.quote_verified).length

  const thesis: [string, string, string, string, string, number, string][] = [
    [t('thesis.brent.who'), pct(total.brent.y), t('thesis.brent.unit'), t('thesis.brent.text', { p: total.brent.p.toFixed(2) }), '#2a78d6', total.brent.n, t('thesis.brent.metric')],
    [t('thesis.ttf.who'), pct(total.ttf.y), t('thesis.ttf.unit'), t('thesis.ttf.text', { p: total.ttf.p.toFixed(2) }), '#eb6834', total.ttf.n, t('thesis.ttf.metric')],
    [t('thesis.agencies.who'), agencyOil.p.toFixed(2), t('thesis.agencies.unit'), t('thesis.agencies.text', { n: agencyOil.n, no: pct(agencyOil.no) }), '#1baf7a', agencyOil.n, t('thesis.agencies.metric')],
    [t('thesis.press.who'), pct(pressGas.y), t('thesis.press.unit'), t('thesis.press.text', { n: pressGas.n }), '#eda100', pressGas.n, t('thesis.press.metric')],
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
            {thesis.map(([who, big, unit, text, color, n, metric], i) => (
              <div key={who} className={`py-5 pe-5 ${i > 0 ? 'lg:ps-5 lg:border-s border-gray-200 border-t sm:border-t-0' : ''} ${i === 1 || i === 3 ? 'sm:ps-5 sm:border-s' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''}`}>
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{who}
                </div>
                <div className="mt-2 text-4xl font-black text-gray-900 tabular-nums">{big}<span className="ms-1.5 text-sm font-normal text-gray-600">{unit}</span></div>
                <div className="mt-1 font-mono text-[11px] text-gray-600">{t('nStat', { n: n.toLocaleString(locale) })} · {metric}{n < 50 && <b className="text-amber-700 font-medium">{t('smallSample')}</b>}</div>
                <p className="mt-2 text-sm text-gray-700 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </header>

        <NumbersGuide />

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('prices.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('prices.intro')}</p>
          <div className="mt-5 space-y-6 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            {LEGS.map(l => (
              <div key={l}>
                <h3 className="font-bold text-gray-900">{t(`legName.${l}`)}<span className="ms-2 font-mono text-xs font-normal text-gray-500">{t(`legUnit.${l}`)}</span></h3>
                <PriceChart leg={l} series={prices[l]} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-600">{t('prices.foot')}</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('who.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('who.intro')}</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-gray-700 mb-2">
              {GROUPS.map(g => (
                <span key={g} className="inline-flex items-center gap-2"><i className="w-3.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{groupName(g)} <span className="font-mono text-gray-500">{pool.filter(r => r.g === g).length}</span></span>
              ))}
              <span className="inline-flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-gray-400/60" />{t('who.oneArticle')}</span>
            </div>
            {LEGS.map(l => (
              <div key={l} className="mt-4">
                <h3 className="font-bold text-gray-900">{t(`legTitle.${l}`)}</h3>
                <PChart leg={l} pool={pool} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-600">{t('who.foot')}</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('voices.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('voices.intro')}</p>
          {LEGS.map(l => (
            <div key={l} className="mt-8">
              <h3 className="font-bold text-gray-900">{t(`legTitle.${l}`)}</h3>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <VoiceColumn title={t('voices.hit')} range="P ≥ 0.75" tone="hit" voices={CARDS[l].hit} leg={l} byN={byN} />
                <VoiceColumn title={t('voices.miss')} range="P ≤ 0.25" tone="miss" voices={CARDS[l].miss} leg={l} byN={byN} />
              </div>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{t('split.h')}</h2>
          <p className="mt-2 max-w-2xl text-gray-700">{t('split.intro', { agencyNo: pct(agencyOil.no), agencyN: agencyOil.n, agencyGas, bankGas, pressN: pressGas.n, pressY: pct(pressGas.y) })}</p>
          {LEGS.map(l => (
            <div key={l} className="mt-6">
              <h3 className="font-bold text-gray-900">{t(`legTitle.${l}`)}</h3>
              <div className="mt-3 grid gap-x-4 gap-y-3 items-center" style={{ gridTemplateColumns: 'minmax(140px,230px) 1fr 64px' }}>
                {GROUPS.map(g => <SplitRow key={g} label={groupName(g)} a={agg(pool.filter(r => r.g === g), l)} />)}
                {REGIONS.map(k => <SplitRow key={k} label={t(`region.${k}`)} a={agg(pool.filter(r => r.r === k), l)} />)}
              </div>
            </div>
          ))}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-700">
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
            <Method title={t('method.voiceT')}>{t('method.voice')}</Method>
          </div>
          <p className="mt-6 text-sm">
            <a href="https://daatan.github.io/retro/studies/energy-2022/pool.csv" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900">{t('method.poolCsv')}</a>
          </p>
          <h3 className="mt-10 text-lg font-extrabold text-gray-900">{t('method.missingH')}</h3>
          <ul className="mt-2 list-disc ps-5 space-y-1.5 text-gray-700 max-w-3xl">
            {[0, 1, 2, 3, 4, 5].map(i => <li key={i}>{t(`method.gaps.${i}`)}</li>)}
            <li>{t('method.quotes', { unverified, total: rows.length })}</li>
          </ul>
        </section>

        <div className="mt-16 text-center text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">{t('footer')}</div>
      </div>
      <ScrollNav />
    </div>
  )
}

function NumbersGuide() {
  const t = useTranslations('retroEnergy')
  const b = (c: React.ReactNode) => <b className="text-gray-900">{c}</b>
  const scaleMarks: [number, string][] = [
    [0.2, t('numbers.eia')],
    [0.5, t('numbers.noView')],
    [0.9, t('numbers.jpm')],
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
              <div key={who} className={`absolute flex flex-col w-40 whitespace-nowrap ${p > 0.85 ? '-translate-x-[calc(100%-6px)] items-end text-right' : '-translate-x-1/2 items-center text-center'} ${i % 2 ? 'top-3' : 'bottom-3 flex-col-reverse'}`} style={{ left: `${p * 100}%` }}>
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

function SplitRow({ label, a }: { label: string; a: Agg }) {
  const t = useTranslations('retroEnergy')
  const seg = (cls: string, v: number, text: string) => v > 0 && (
    <span className={`flex items-center justify-center overflow-hidden whitespace-nowrap font-mono text-xs font-medium first:rounded-l last:rounded-r ${cls}`} style={{ flex: v }} title={`${text} ${pct(v)}`}>{v >= 0.09 ? pct(v) : ''}</span>
  )
  return (
    <>
      <div className="text-sm leading-tight">{label}<span className="block font-mono text-xs text-gray-500">{t('split.articles', { n: a.n })}</span></div>
      <div className="flex h-6 gap-[2px]" role="img" aria-label={t('split.aria', { label, y: pct(a.y), u: pct(a.u), no: pct(a.no) })}>
        {seg('bg-teal-600 text-white', a.y, t('split.expects'))}
        {seg('bg-gray-300 text-gray-800', a.u, t('split.uncertain'))}
        {seg('bg-rose-600 text-white', a.no, t('split.doesNot'))}
      </div>
      <div className="text-right font-mono text-[15px] font-medium tabular-nums">{a.p.toFixed(2)}<span className="block text-[11px] text-gray-500">{t('split.meanP')}</span></div>
    </>
  )
}

function VoiceColumn({ title, range, tone, voices, leg, byN }: { title: string; range: string; tone: 'hit' | 'miss'; voices: number[]; leg: Leg; byN: Map<number, ReportRow> }) {
  const t = useTranslations('retroEnergy')
  const color = tone === 'hit' ? 'text-teal-700 border-teal-700' : 'text-rose-700 border-rose-700'
  return (
    <div>
      <div className={`flex items-baseline justify-between border-b-2 pb-1.5 ${color}`}>
        <h4 className="text-lg font-extrabold">{title}</h4><span className="font-mono text-xs">{range}</span>
      </div>
      {voices.map(n => {
        const r = byN.get(n)
        if (!r) return null
        const vk = `cards.${leg}.${tone}.${n}`
        const p = leg === 'brent' ? r.p_brent : r.p_ttf
        return (
          <article key={n} className="grid grid-cols-[64px_1fr] gap-x-4 py-4 border-b border-gray-200">
            <div className={`row-span-3 text-2xl font-black tabular-nums ${tone === 'hit' ? 'text-teal-700' : 'text-rose-700'}`}>
              {p == null ? '—' : (Math.round(p * 100) / 100).toFixed(2)}
              <span className="block mt-1 font-mono text-[10px] font-normal text-gray-500">{t('voices.p')}</span>
            </div>
            <div className="font-mono text-xs text-gray-500">{r.date.split('-').reverse().join('.')} · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">{r.domain}</a></div>
            <div className="font-bold text-gray-900 leading-snug">{t(`${vk}.name`)}<span className="block font-normal text-sm text-gray-600">{t(`${vk}.role`)}</span></div>
            <div>
              <blockquote className="mt-1.5 italic text-gray-800 leading-relaxed">“{r.key_quote_en ?? r.key_quote}”</blockquote>
              <p className="mt-1.5 text-sm text-gray-600">{t(`${vk}.note`)}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(300, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [box, width]
}

function PriceChart({ leg, series }: { leg: Leg; series: PriceSeries }) {
  const t = useTranslations('retroEnergy')
  const locale = useLocale()
  const [box, W] = useWidth()
  const narrow = W < 560
  const H = narrow ? 220 : 260, L = 44, R = 12, T = 10, B = 26
  const data = useMemo(() => series.map(([d, v]) => [Date.parse(d), v] as const), [series])
  const stepV = leg === 'ttf' ? 50 : 10
  const vmax = Math.ceil(Math.max(...data.map(d => d[1]), THRESHOLD[leg]) / stepV) * stepV
  const x = (t: number) => L + (t - T0) / (T1 - T0) * (W - L - R)
  const y = (v: number) => T + (1 - v / vmax) * (H - T - B)
  const grid: number[] = []
  for (let v = 0; v <= vmax; v += leg === 'ttf' ? 100 : 40) grid.push(v)
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  return (
    <div ref={box} dir="ltr" className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={t('prices.aria', { leg: t(`legName.${leg}`) })}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          <rect x={x(T0)} y={T} width={x(TW) - x(T0)} height={H - T - B} fill="#e5e7eb" fillOpacity={0.6} />
          {grid.map(v => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#eceff3" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </g>
          ))}
          {MONTH_TICKS.map((m, mi) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={T} y2={H - B} stroke="#eceff3" />
              {(!narrow || mi % 2 === 0) && <text x={x(m) + 3} y={H - 6}>{monthLabel(locale, m)}</text>}
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(THRESHOLD[leg])} y2={y(THRESHOLD[leg])} stroke="#be123c" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={W - R - 4} y={y(THRESHOLD[leg]) - 5} textAnchor="end" fill="#be123c" fontWeight={500}>{THRESHOLD_LABEL[leg]}</text>
          <path d={d} fill="none" stroke="#111827" strokeWidth={1.8} />
          <line x1={x(TW)} x2={x(TW)} y1={T} y2={H - B} stroke="#be123c" strokeWidth={1.5} />
          <text x={x(TW) + 5} y={T + 12} fill="#be123c">{t('prices.invasionDate')}</text>
          <text x={x(T0) + 4} y={T + 12}>{t('prices.window')}</text>
        </g>
      </svg>
    </div>
  )
}

function PChart({ leg, pool }: { leg: Leg; pool: PoolRow[] }) {
  const t = useTranslations('retroEnergy')
  const locale = useLocale()
  const [box, W] = useWidth()
  const f = LEG_FIELD[leg]
  const narrow = W < 640
  const H = narrow ? 260 : 300, L = 44, R = narrow ? 84 : 120, T = 10, B = 26
  const TX = TW + 12 * DAY
  const x = (t: number) => L + (t - T0) / (TX - T0) * (W - L - R)
  const y = (p: number) => T + (1 - p) * (H - T - B)
  const pts = useMemo(() => pool.filter(r => r[f] != null).map(r => ({ g: r.g, t: Date.parse(r.d), p: r[f] as number })), [pool, f])
  const jitter = useMemo(() => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    return pts.map(() => [(rnd() - 0.5) * 4, (rnd() - 0.5) * 8])
  }, [pts])
  const lines = useMemo(() => {
    const days: number[] = []
    for (let t = T0 + 14 * DAY; t <= TW; t += DAY) days.push(t)
    return GROUPS.map(g => {
      let d = '', pen = false
      let last: { t: number; m: number } | null = null
      for (const t of days) {
        const w = pts.filter(r => r.g === g && r.t <= t && r.t > t - ROLL)
        if (w.length < 4) { pen = false; continue }
        const m = w.reduce((a, r) => a + r.p, 0) / w.length
        d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(m).toFixed(1)}`
        pen = true
        last = { t, m }
      }
      return { g, d, last }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, W, H])
  const labels = lines
    .filter((l): l is typeof l & { last: { t: number; m: number } } => l.last != null)
    .map(l => ({ g: l.g, m: l.last.m, ly: y(l.last.m) }))
    .sort((a, b) => a.ly - b.ly)
  for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 15) labels[i].ly = labels[i - 1].ly + 15

  return (
    <div ref={box} dir="ltr" className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={t('who.aria', { title: t(`legTitle.${leg}`) })}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          <rect x={x(T0)} y={T} width={x(TW) - x(T0)} height={H - T - B} fill="#e5e7eb" fillOpacity={0.35} />
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? '#6b7280' : '#eceff3'} strokeDasharray={p === 0.5 ? '3 4' : undefined} />
              <text x={L - 6} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
            </g>
          ))}
          {MONTH_TICKS.filter(m => m <= TX).map(m => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={T} y2={H - B} stroke="#eceff3" />
              <text x={x(m) + 3} y={H - 6}>{monthLabel(locale, m)}</text>
            </g>
          ))}
        </g>
        {pts.map((r, i) => (
          <circle key={i} cx={x(r.t) + jitter[i][0]} cy={y(r.p) + jitter[i][1]} r={narrow ? 2 : 2.5} fill={GROUP_COLOR[r.g]} fillOpacity={0.3} />
        ))}
        {lines.map(({ g, d }) => d && (
          <g key={g}>
            <path d={d} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" />
            <path d={d} fill="none" stroke={GROUP_COLOR[g]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        <line x1={x(TW)} x2={x(TW)} y1={T} y2={H - B} stroke="#be123c" strokeWidth={1.5} />
        <text x={x(TW) + 5} y={T + 12} className="font-mono" fontSize={11.5} fill="#be123c">{t('prices.invasionDate')}</text>
        {labels.map(l => (
          <text key={l.g} x={x(TW) + 6} y={l.ly + 14} fontSize={narrow ? 10.5 : 12} fontWeight={700} fill={GROUP_COLOR[l.g]}>{t(`groupShort.${l.g}`)} {Math.round(l.m * 100)}</text>
        ))}
      </svg>
    </div>
  )
}

type SortKey = 'n' | 'date' | 'voice_name' | 'p_brent' | 'p_ttf'
type LegFilter = '' | Leg

function PBar({ p, price, unit }: { p: number | null; price: number | null; unit: string }) {
  const t = useTranslations('retroEnergy')
  if (p == null) return <span className="text-gray-400">—</span>
  const s = sideOf(p)
  return (
    <div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="relative w-16 h-1.5 bg-gray-100 rounded"><span className="absolute inset-y-0 left-0 rounded bg-gray-700" style={{ width: `${p * 100}%` }} /><span className="absolute -inset-y-0.5 left-1/2 w-px bg-gray-400" /></span>
        <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${SIDE_PILL[s]}`}>{p.toFixed(2)}</span>
      </div>
      {price != null && <div className="mt-0.5 font-mono text-xs text-gray-500">{t('table.priceEstimate', { price: unit === '$' ? `$${price}` : `€${price}` })}</div>}
    </div>
  )
}

function ArticleTable({ rows }: { rows: ReportRow[] }) {
  const t = useTranslations('retroEnergy')
  const groupName = (g: Group) => t(`group.${g}`)
  const [fLeg, setFLeg] = useState<LegFilter>('')
  const [fGroup, setFGroup] = useState('')
  const [fSide, setFSide] = useState('')
  const [fReg, setFReg] = useState('')
  const [q, setQ] = useState('')
  const [sortK, setSortK] = useState<SortKey>('date')
  const [dir, setDir] = useState(1)

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const legP = (r: ReportRow) => (fLeg === 'brent' ? [r.p_brent] : fLeg === 'ttf' ? [r.p_ttf] : [r.p_brent, r.p_ttf])
    const rs = rows.filter(r =>
      (!fLeg || legP(r)[0] != null) && (!fGroup || r.g === fGroup) && (!fReg || r.reg === fReg) &&
      (!fSide || legP(r).some(p => p != null && sideOf(p) === fSide)) &&
      (!qq || [r.title, r.domain, r.voice_name, r.voice_affiliation, r.summary, r.key_quote, r.key_quote_en].join(' ').toLowerCase().includes(qq)))
    return [...rs].sort((a, b) => {
      const A = a[sortK] ?? (dir > 0 ? '~' : ''), B = b[sortK] ?? (dir > 0 ? '~' : '')
      return (A > B ? 1 : A < B ? -1 : 0) * dir
    })
  }, [rows, fLeg, fGroup, fSide, fReg, q, sortK, dir])

  const sortBy = (k: SortKey) => {
    if (k === sortK) setDir(-dir)
    else { setSortK(k); setDir(k.startsWith('p_') ? -1 : 1) }
  }
  const thCls = 'sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600 whitespace-nowrap'
  const th = (k: SortKey, label: string, right = false, sub?: string) => (
    <th className={`${thCls} ${right ? 'text-end' : 'text-start'}`} aria-sort={sortK === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)} className="uppercase">{label}{sortK === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>{sub && <span className="block normal-case tracking-normal font-sans text-[11px] font-normal text-gray-500">{sub}</span>}
    </th>
  )
  const sel = 'bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-sm text-gray-800 min-w-[150px]'
  const lbl = 'flex flex-col gap-1 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600'

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className={lbl}>{t('table.market')}<select className={sel} value={fLeg} onChange={e => setFLeg(e.target.value as LegFilter)}><option value="">{t('table.both')}</option><option value="brent">{t('table.oil')}</option><option value="ttf">{t('table.gas')}</option></select></label>
        <label className={lbl}>{t('table.voice')}<select className={sel} value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">{t('table.all')}</option>{GROUPS.map(g => <option key={g} value={g}>{groupName(g)}</option>)}</select></label>
        <label className={lbl}>{t('table.position')}<select className={sel} value={fSide} onChange={e => setFSide(e.target.value)}><option value="">{t('table.all')}</option><option value="high">{t('side.high')}</option><option value="uncertain">{t('side.uncertain')}</option><option value="low">{t('side.low')}</option></select></label>
        <label className={lbl}>{t('table.outlet')}<select className={sel} value={fReg} onChange={e => setFReg(e.target.value)}><option value="">{t('table.all')}</option>{REGIONS.map(k => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></label>
        <label className={lbl}>{t('table.search')}<input type="search" className={`${sel} min-w-[210px]`} placeholder={t('table.placeholder')} value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="ms-auto font-mono text-xs text-gray-600">{t('table.shown', { shown: shown.length, total: rows.length })}</span>
      </div>
      <ul className="md:hidden space-y-3">
        {shown.map(r => (
          <li key={r.n} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-gray-600">
              <span>#{r.n} · {r.date}</span>
              <span className="flex gap-1.5">
                {r.p_brent != null && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${SIDE_PILL[sideOf(r.p_brent)]}`}>{t('legName.brent')} {r.p_brent.toFixed(2)}</span>}
                {r.p_ttf != null && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${SIDE_PILL[sideOf(r.p_ttf)]}`}>{t('legName.ttf')} {r.p_ttf.toFixed(2)}</span>}
              </span>
            </div>
            <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="mt-2 block font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
            <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ` · ${t('table.archive')}` : ''}</div>
            <div className="mt-2 text-sm text-gray-800">
              <span className="inline-block w-2 h-2 rounded-sm me-1.5" style={{ background: GROUP_COLOR[r.g] }} title={groupName(r.g)} />
              {r.voice_name || '—'}{r.voice_affiliation && <span className="text-gray-600"> · {r.voice_affiliation}</span>}
            </div>
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
            <th className={`${thCls} text-start`}>{t('table.article')}</th>
            {th('voice_name', t('table.mainVoice'), false, t('table.mainVoiceSub'))}{th('p_brent', t('table.pBrent'))}{th('p_ttf', t('table.pTtf'))}
            <th className={`${thCls} text-start`}>{t('table.summary')}</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.n} className="align-top border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.n}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2.5 min-w-[240px] max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
                  <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ` · ${t('table.archive')}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                  <span className="inline-block w-2 h-2 rounded-sm me-1.5" style={{ background: GROUP_COLOR[r.g] }} title={groupName(r.g)} />
                  {r.voice_name || '—'}<span className="block text-xs text-gray-500 leading-snug">{r.voice_affiliation}</span>
                </td>
                <td className="px-3 py-2.5"><PBar p={r.p_brent} price={r.price_brent} unit="$" /></td>
                <td className="px-3 py-2.5"><PBar p={r.p_ttf} price={r.price_ttf} unit="€" /></td>
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
