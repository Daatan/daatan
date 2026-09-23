'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, PoolRow, Region, ReportRow, Side } from './types'

const GROUPS: Group[] = ['west', 'analysts', 'ua', 'ru']
const GROUP_NAME: Record<Group, string> = {
  west: 'Western governments & intelligence',
  analysts: 'Analysts & press',
  ua: 'Ukrainian officials',
  ru: 'Russian officials',
}
const GROUP_SHORT: Record<Group, string> = { west: 'West', analysts: 'Analysts', ua: 'Kyiv', ru: 'Moscow' }
const GROUP_COLOR: Record<Group, string> = { west: '#2a78d6', analysts: '#1baf7a', ua: '#eda100', ru: '#eb6834' }
const REGION_NAME: Record<Region, string> = { west: 'International outlets', ua: 'Ukrainian outlets', ru: 'Russian outlets' }
const SIDE_LABEL: Record<Side, string> = { invasion: 'expects it', uncertain: 'unsure', no_invasion: "doesn't" }
const SIDE_PILL: Record<Side, string> = {
  invasion: 'bg-teal-50 text-teal-800',
  uncertain: 'bg-amber-50 text-amber-800',
  no_invasion: 'bg-rose-50 text-rose-800',
}
const SCOPE: Record<string, string> = {
  full_scale: 'full-scale',
  limited_donbas: 'Donbas only',
  limited_strikes_or_partial: 'limited',
  none: 'none',
  unclear: 'unclear',
}
const EVENTS: [string, string][] = [
  ['2021-11-21', 'Budanov: attack likely in late January or early February'],
  ['2021-12-07', 'Biden–Putin video call'],
  ['2021-12-17', 'Russia publishes draft treaties with the US and NATO'],
  ['2022-01-10', 'Geneva talks, then NATO–Russia Council and OSCE'],
  ['2022-01-19', 'Biden’s “minor incursion” remark'],
  ['2022-01-28', 'Zelensky: “we don’t need this panic”'],
  ['2022-02-11', 'Sullivan: invasion could begin any day'],
  ['2022-02-21', 'Russia recognises the DNR and LNR'],
]

interface Voice { n: number; name: string; role: string; quote: string; note?: string }
const HIT: Voice[] = [
  { n: 1, name: 'Kyrylo Budanov', role: 'Head of Ukrainian military intelligence (GUR)', quote: 'Россия сосредоточила у границ Украины более 92 тыс. военнослужащих и готовится к нападению в конце января или начале февраля 2022 года.', note: 'Described a multi-axis assault three months out. Off on timing by about three weeks, right on scale.' },
  { n: 126, name: 'Rob Lee', role: "King's College London", quote: '…believes that a Russian military operation against Ukraine is more likely than not, in part because of the unprecedented scale of the Russian military buildup underway around the country.', note: 'The Washington Post paraphrasing his view. Lee tracked the buildup through open-source data.' },
  { n: 151, name: 'Joe Biden', role: 'US President, quoted in The New York Times', quote: 'My guess is he will move in. He has to do something.', note: 'From the same 19 January press conference as the “minor incursion” remark.' },
  { n: 158, name: 'Jonathan Finer', role: 'US Deputy National Security Adviser', quote: "Whatever Russian officials are saying in public about their intentions, we have to take that with a grain of salt because of what we're actually seeing with our own eyes." },
]
const MISS: Voice[] = [
  { n: 17, name: 'Dmitry Peskov', role: 'Kremlin spokesman', quote: 'Слова о якобы планируемом Россией нападении абсолютно беспочвенны.', note: '“Talk of an allegedly planned Russian attack is absolutely groundless.” The line held until 21 February.' },
  { n: 48, name: 'Institute for the Study of War', role: 'Washington think tank', quote: 'Putin does not, in fact, intend to invade unoccupied Ukraine this winter despite the continued build-up of Russian forces in preparation to do so.', note: 'One of the few Western think tanks to say no outright.' },
  { n: 86, name: 'Oleksiy Danilov', role: "Secretary of Ukraine's National Security and Defence Council", quote: 'Сейчас угрозы открытой агрессии Российской Федерации против Украины не наблюдается… Поэтому отдыхайте спокойно, празднуйте.', note: '“There is no threat of open aggression… So rest easy and celebrate.” A month earlier he had disputed Budanov’s warning.' },
  { n: 121, name: 'Dmitri Trenin', role: 'Carnegie Moscow Center', quote: 'In the immediate future, say, the coming month, I think the answer is no.', note: 'Said on 20 January. The month ran out on 20 February, four days before the invasion.' },
  { n: 129, name: 'Jeff Hawn', role: 'London School of Economics, in Foreign Policy', quote: 'While a full-scale invasion across Ukraine remains highly unlikely, there are a range of other options open to Russia.', note: 'The typical sceptic case: recognition of the republics or limited strikes would serve Moscow better.' },
]

interface Agg { n: number; p: number; y: number; u: number; no: number }
function agg(rs: PoolRow[]): Agg {
  const n = rs.length
  if (!n) return { n: 0, p: 0, y: 0, u: 0, no: 0 }
  return {
    n,
    p: rs.reduce((a, r) => a + r.p, 0) / n,
    y: rs.filter(r => r.s === 'i').length / n,
    u: rs.filter(r => r.s === 'u').length / n,
    no: rs.filter(r => r.s === 'n').length / n,
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmtDay = (d: string) => { const [, m, dd] = d.split('-'); return `${Number(dd)}.${m}` }
const DAY = 864e5
const T0 = Date.parse('2021-11-20')
const T1 = Date.parse('2022-02-24')

export default function UkraineRetroReport({ rows, pool }: { rows: ReportRow[]; pool: PoolRow[] }) {
  const byGroup = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, agg(pool.filter(r => r.g === g))])) as Record<Group, Agg>, [pool])
  const byRegion = useMemo(() => Object.fromEntries((['west', 'ua', 'ru'] as Region[]).map(k => [k, agg(pool.filter(r => r.r === k))])) as Record<Region, Agg>, [pool])
  const byN = useMemo(() => new Map(rows.map(r => [r.n, r])), [rows])
  const unverified = rows.filter(r => !r.quote_verified).length

  const thesis: [Group, string, string, string][] = [
    ['west', pct(byGroup.west.p), 'mean P', `Western governments and intelligence services were nearly unanimous. Only ${pct(byGroup.west.no)} of their statements said no.`],
    ['analysts', pct(byGroup.analysts.p), 'mean P', `Experts and journalists mostly sided with Washington, but about one in ${Math.round(1 / byGroup.analysts.no)} did not believe in war.`],
    ['ua', pct(byGroup.ua.no), 'say “no”', 'Kyiv was split. Military intelligence warned, while the Security Council and the President’s Office urged no panic.'],
    ['ru', pct(byGroup.ru.no), 'say “no”', `The Kremlin and the Foreign Ministry called invasion talk hysteria until the end. Their mean P was ${pct(byGroup.ru.p)}.`],
  ]

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-gray-800">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link href="/retroanalysis" className="text-xs font-bold tracking-widest uppercase text-gray-400 hover:text-gray-700">← Retro Analysis</Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono uppercase tracking-widest text-gray-500">
            <span>Case E01</span><span>Window 20 Nov 2021 → <b className="text-rose-700 font-medium">24 Feb 2022</b></span>
          </div>
          <h1 className="mt-4 text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-[1.05]">
            Who saw <span className="text-rose-700">24 February</span> coming
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-gray-600 leading-relaxed">
            The three months before Russia&apos;s full-scale invasion of Ukraine: {pool.length} statements from world, Russian and Ukrainian media, think tanks and officials.
            Each article was read in full and rated on one question: how likely did its main voice think a full-scale invasion was, on the day it was published?
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t-2 border-gray-900 border-b border-gray-200">
            {thesis.map(([g, big, unit, text], i) => (
              <div key={g} className={`py-5 pr-5 ${i > 0 ? 'lg:pl-5 lg:border-l border-gray-200' : ''} ${i > 0 ? 'border-t sm:border-t-0' : ''} ${i === 1 || i === 3 ? 'sm:pl-5 sm:border-l' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''}`}>
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GROUP_COLOR[g] }} />{GROUP_NAME[g]}
                </div>
                <div className="mt-2 text-4xl font-black text-gray-900 tabular-nums">{big}<span className="ml-1.5 text-sm font-normal text-gray-500">{unit}</span></div>
                <p className="mt-2 text-sm text-gray-600 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </header>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Three months of argument in one chart</h2>
          <p className="mt-2 max-w-2xl text-gray-600">Each dot is one article, placed at the invasion probability its main voice expressed. Each line is that group&apos;s mean over the previous 14 days: what a reader could have seen at the time, without hindsight.</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-gray-600 mb-2">
              {GROUPS.map(g => (
                <span key={g} className="inline-flex items-center gap-2"><i className="w-3.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{GROUP_NAME[g]} <span className="font-mono text-gray-400">{byGroup[g].n}</span></span>
              ))}
              <span className="inline-flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-gray-400/60" />one article</span>
            </div>
            <TrendChart pool={pool} />
            <ol className="mt-4 grid gap-x-6 gap-y-1.5 text-[13px] text-gray-600" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
              {EVENTS.map(([d, t], i) => (
                <li key={d} className="flex gap-2.5 items-baseline">
                  <b className="flex-none inline-grid place-items-center w-5 h-5 rounded-full border border-gray-500 font-mono text-[11px] font-medium">{i + 1}</b>
                  <span><span className="font-mono text-xs text-gray-400">{fmtDay(d)}</span> {t}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-xs text-gray-500">Full pool after filtering, {pool.length} articles. The dashed line at 50% separates “more likely than not” from “less likely”. Hover the chart for the group means on a given day.</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who got it right, who didn&apos;t</h2>
          <p className="mt-2 max-w-2xl text-gray-600">The clearest calls on both sides. The number is the invasion probability we assigned. Quotes are checked against the article text.</p>
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <VoiceColumn title="Expected the invasion" range="P ≥ 0.75" tone="hit" voices={HIT} byN={byN} />
            <VoiceColumn title="Did not expect it" range="P ≤ 0.35" tone="miss" voices={MISS} byN={byN} />
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who said “yes”, who said “no”</h2>
          <p className="mt-2 max-w-2xl text-gray-600">Share of positions by type of voice and by the outlet&apos;s country. Russian outlets are softer than their own government because they often relayed Western warnings, if only to rebut them. Ukrainian outlets barely differ from international ones.</p>
          <div className="mt-6 grid gap-x-4 gap-y-3 items-center" style={{ gridTemplateColumns: 'minmax(140px,230px) 1fr 64px' }}>
            <SplitHeader label="By voice" />
            {GROUPS.map(g => <SplitRow key={g} label={GROUP_NAME[g]} a={byGroup[g]} />)}
            <SplitHeader label="By outlet" />
            {(['west', 'ua', 'ru'] as Region[]).map(k => <SplitRow key={k} label={REGION_NAME[k]} a={byRegion[k]} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-600">
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-teal-600" />expects invasion, P ≥ 0.6</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-gray-300" />unsure</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-rose-600" />does not, P ≤ 0.4</span>
            <span className="font-mono text-gray-400">right: mean P</span>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{rows.length} articles</h2>
          <p className="mt-2 max-w-2xl text-gray-600">A balanced sample of the pool: at most 8 articles per outlet and 2 per speaker, with sceptics raised to 35% so their arguments stay visible. The score is an inverted Brier score: the closer to 100, the better the voice called the outcome.</p>
          <ArticleTable rows={rows} />
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Method</h2>
          <div className="mt-5 grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <Method title="Search">GDELT GKG via BigQuery over 122 domains: the sources news-indexer monitors, plus major world, Russian and Ukrainian outlets and think tanks. That gave 105,001 URLs. Gaps were filled from the Wayback archive, and key sceptics were found by hand.</Method>
            <Method title="Filter">Title keywords kept 5,007 candidates, and Claude Haiku kept 2,432 of those on title alone. Full texts then dropped irrelevant pieces, repeats of one speaker on one day, and anything edited after 24 February. Dates were checked against the page itself.</Method>
            <Method title="Rating" formula="P = 0.5 + 0.5 × stance">The model reads the text as of its publication date and returns the main voice&apos;s stance from −1 to +1, confidence, expected scope and a verbatim quote. Expecting a Donbas-only operation caps P at 0.35, and limited strikes cap it at 0.45.</Method>
            <Method title="Score" formula="score = 100 × (1 − (1 − P)²)">An inverted Brier score for the outcome “the invasion happened”. P = 0.5 scores 75, a confident “no” scores about 0–10, and a confident “yes” about 100. The score belongs to the voice, not the outlet: a Reuters piece relaying Biden gets Biden&apos;s score.</Method>
          </div>
          <h3 className="mt-10 text-lg font-extrabold text-gray-900">What is missing</h3>
          <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600 max-w-3xl">
            <li>FT, WSJ and Bloomberg are absent: GDELT lacks them for this window and they are paywalled. AP almost entirely collapsed in deduplication because it relays the same officials.</li>
            <li>We could not fetch the Metaculus forecast, Zelensky&apos;s 28 January press conference, Fiona Hill&apos;s NYT column, or Macron&apos;s 8 February statement.</li>
            <li>154 texts come from live pages and 46 from Wayback snapshots taken before 24 February. No signs of later edits were found in the live texts.</li>
            <li>{unverified} of {rows.length} quotes were not found verbatim in the text. They are model paraphrases and are flagged in the table.</li>
            <li>Telegram, social media and broadcasts are not covered. Ratings are by the model, with about 60 rows checked by hand.</li>
          </ul>
        </section>

        <div className="mt-16 text-center text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">DAATAN Retro-Analysis Archive · E01 · built 23 Sep 2026</div>
      </div>
    </div>
  )
}

function Method({ title, formula, children }: { title: string; formula?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-[15px] text-gray-600 leading-relaxed">{children}</p>
      {formula && <div className="mt-2 inline-block font-mono text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900">{formula}</div>}
    </div>
  )
}

function SplitHeader({ label }: { label: string }) {
  return <div className="col-span-3 pt-3 text-[11px] font-mono uppercase tracking-widest text-gray-400">{label}</div>
}

function SplitRow({ label, a }: { label: string; a: Agg }) {
  const seg = (cls: string, v: number, text: string) => v > 0 && (
    <span className={`flex items-center justify-center overflow-hidden whitespace-nowrap font-mono text-xs font-medium first:rounded-l last:rounded-r ${cls}`} style={{ flex: v }} title={`${text} ${pct(v)}`}>{v >= 0.09 ? pct(v) : ''}</span>
  )
  return (
    <>
      <div className="text-sm leading-tight">{label}<span className="block font-mono text-xs text-gray-400">{a.n} articles</span></div>
      <div className="flex h-6 gap-[2px]" role="img" aria-label={`${label}: expects ${pct(a.y)}, unsure ${pct(a.u)}, does not ${pct(a.no)}`}>
        {seg('bg-teal-600 text-white', a.y, 'expects')}
        {seg('bg-gray-300 text-gray-800', a.u, 'unsure')}
        {seg('bg-rose-600 text-white', a.no, 'does not')}
      </div>
      <div className="text-right font-mono text-[15px] font-medium tabular-nums">{a.p.toFixed(2)}<span className="block text-[11px] text-gray-400">mean P</span></div>
    </>
  )
}

function VoiceColumn({ title, range, tone, voices, byN }: { title: string; range: string; tone: 'hit' | 'miss'; voices: Voice[]; byN: Map<number, ReportRow> }) {
  const color = tone === 'hit' ? 'text-teal-700 border-teal-700' : 'text-rose-700 border-rose-700'
  return (
    <div>
      <div className={`flex items-baseline justify-between border-b-2 pb-1.5 ${color}`}>
        <h3 className="text-lg font-extrabold">{title}</h3><span className="font-mono text-xs">{range}</span>
      </div>
      {voices.map(v => {
        const r = byN.get(v.n)
        if (!r) return null
        return (
          <article key={v.n} className="grid grid-cols-[64px_1fr] gap-x-4 py-4 border-b border-gray-200">
            <div className={`row-span-3 text-2xl font-black tabular-nums ${tone === 'hit' ? 'text-teal-700' : 'text-rose-700'}`}>
              {r.p_full.toFixed(2)}
              <span className="block mt-1 font-mono text-[10px] font-normal text-gray-400">score {r.score}</span>
            </div>
            <div className="font-mono text-xs text-gray-400">{r.date.split('-').reverse().join('.')} · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">{r.domain}</a></div>
            <div className="font-bold text-gray-900 leading-snug">{v.name}<span className="block font-normal text-sm text-gray-500">{v.role}</span></div>
            <div>
              <blockquote className="mt-1.5 italic text-gray-800 leading-relaxed">“{v.quote}”</blockquote>
              {v.note && <p className="mt-1.5 text-sm text-gray-500">{v.note}</p>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

interface Tip { x: number; y: number; i: number }

function TrendChart({ pool }: { pool: PoolRow[] }) {
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
    for (let t = Date.parse('2021-11-27'); t <= Date.parse('2022-02-23'); t += DAY) out.push(t)
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
  const W = width, H = narrow ? 380 : 440, L = 38, R = narrow ? 92 : 112, T = 34, B = 26
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

  const months: [string, string][] = [['2021-12-01', 'Dec'], ['2022-01-01', 'Jan'], ['2022-02-01', 'Feb']]
  const hx = tip ? x(days[tip.i]) : 0

  return (
    <div ref={box} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label="Mean invasion probability by group of voices, November 2021 to February 2022">
        <g className="font-mono" fontSize={11.5} fill="#6b7280">
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={L} x2={x(T1)} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? '#6b7280' : '#eceff3'} strokeDasharray={p === 0.5 ? '3 4' : undefined} />
              <text x={L - 8} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
            </g>
          ))}
          <text x={x(T0)} y={H - 6}>Nov</text>
          {months.map(([d, l]) => (
            <g key={d}>
              <line x1={x(Date.parse(d))} x2={x(Date.parse(d))} y1={T} y2={H - B} stroke="#eceff3" />
              <text x={x(Date.parse(d)) + 4} y={H - 6}>{l}</text>
            </g>
          ))}
          {EVENTS.map(([d], i) => {
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
        <text x={x(T1)} y={H - 6} textAnchor="middle" className="font-mono" fontSize={11.5} fill="#be123c" fontWeight={500}>24.02</text>
        {labels.map(l => (
          <text key={l.g} x={x(T1) + 6} y={l.ly + 4} fontSize={narrow ? 11 : 12.5} fontWeight={700} fill={GROUP_COLOR[l.g]}>{GROUP_SHORT[l.g]} {Math.round(l.m * 100)}</text>
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
  const date = new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div ref={ref} className="fixed z-20 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5 text-[13px] min-w-[240px]" style={pos}>
      <div className="font-mono text-xs text-gray-500 mb-1.5">{date} · 14-day mean · {Math.round((T1 - day) / DAY)} days to go</div>
      {sorted.map(g => {
        const m = roll[g][tip.i]
        return (
          <div key={g} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-gray-600"><i className="w-2.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{GROUP_NAME[g]}</span>
            <b className={`font-mono font-medium tabular-nums ${m == null ? 'text-gray-400' : ''}`}>{m == null ? 'few' : pct(m)}</b>
          </div>
        )
      })}
    </div>
  )
}

type SortKey = 'n' | 'date' | 'voice_name' | 'p_full' | 'predicted_scope' | 'score'

function ArticleTable({ rows }: { rows: ReportRow[] }) {
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
    else { setSortK(k); setDir(k === 'score' || k === 'p_full' ? -1 : 1) }
  }
  const th = (k: SortKey, label: string, right = false) => (
    <th className={`sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      aria-sort={sortK === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)} className="uppercase">{label}{sortK === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  )
  const sel = 'bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-sm text-gray-800 min-w-[150px]'
  const lbl = 'flex flex-col gap-1 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500'

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className={lbl}>Voice<select className={sel} value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">all</option>{GROUPS.map(g => <option key={g} value={g}>{GROUP_NAME[g]}</option>)}</select></label>
        <label className={lbl}>Position<select className={sel} value={fSide} onChange={e => setFSide(e.target.value)}><option value="">all</option><option value="invasion">expects invasion</option><option value="uncertain">unsure</option><option value="no_invasion">does not</option></select></label>
        <label className={lbl}>Outlet<select className={sel} value={fReg} onChange={e => setFReg(e.target.value)}><option value="">all</option><option value="west">international</option><option value="ua">Ukrainian</option><option value="ru">Russian</option></select></label>
        <label className={lbl}>Search<input type="search" className={`${sel} min-w-[210px]`} placeholder="name, outlet, word" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="ml-auto font-mono text-xs text-gray-500">{shown.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead><tr>
            {th('n', '#', true)}{th('date', 'Date')}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 text-left">Article</th>
            {th('voice_name', 'Main voice')}{th('p_full', 'P invasion')}{th('predicted_scope', 'Scope')}{th('score', 'Score', true)}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 text-left">Summary & quote</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.n} className="align-top border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.n}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2.5 min-w-[240px] max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ' · archived' : ''}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: GROUP_COLOR[r.g] }} title={GROUP_NAME[r.g]} />
                  {r.voice_name || '—'}<span className="block text-xs text-gray-400 leading-snug">{r.voice_affiliation}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="relative w-16 h-1.5 bg-gray-100 rounded"><span className="absolute inset-y-0 left-0 rounded bg-gray-700" style={{ width: `${r.p_full * 100}%` }} /><span className="absolute -inset-y-0.5 left-1/2 w-px bg-gray-400" /></span>
                    <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${SIDE_PILL[r.side]}`}>{r.p_full.toFixed(2)} {SIDE_LABEL[r.side]}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">confidence {(r.claim_strength ?? 0).toFixed(2)}</div>
                </td>
                <td className="px-3 py-2.5">{SCOPE[r.predicted_scope ?? ''] ?? r.predicted_scope}<div className="font-mono text-xs text-gray-400">{r.timeframe}</div></td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.score}</td>
                <td className="px-3 py-2.5 min-w-[260px] max-w-[420px]">
                  <details>
                    <summary className="cursor-pointer text-[13px] text-gray-600 leading-snug">{r.summary}</summary>
                    <blockquote className="mt-2 pl-2.5 border-l-2 border-gray-200 italic text-[13px] text-gray-800">
                      {r.key_quote_en}
                      {r.key_quote && r.key_quote !== r.key_quote_en && <span className="block mt-1 text-gray-400">{r.key_quote}</span>}
                    </blockquote>
                    {!r.quote_verified && <div className="mt-1 font-mono text-[11px] text-amber-700">quote not found verbatim</div>}
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
