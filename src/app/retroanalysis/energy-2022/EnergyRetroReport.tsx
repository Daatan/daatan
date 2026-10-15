'use client'

import Link from 'next/link'
import ScrollNav from '../ScrollNav'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, Leg, PoolRow, PriceSeries, Prices, Region, ReportRow, Side } from './types'

const GROUPS: Group[] = ['banks', 'agencies', 'insiders', 'press']
const GROUP_NAME: Record<Group, string> = {
  banks: 'Banks',
  agencies: 'Agencies (IEA, EIA, OPEC, EC)',
  insiders: 'Companies and governments',
  press: 'Analysts and press',
}
const GROUP_SHORT: Record<Group, string> = { banks: 'Banks', agencies: 'Agencies', insiders: 'Companies', press: 'Press' }
const GROUP_COLOR: Record<Group, string> = { banks: '#2a78d6', agencies: '#1baf7a', insiders: '#eb6834', press: '#eda100' }
const REGIONS: Region[] = ['en', 'ru', 'eu', 'ar']
const REGION_NAME: Record<Region, string> = {
  en: 'English-language',
  ru: 'Russian-language',
  eu: 'European, non-English',
  ar: 'Arabic-language',
}
const LEG_FIELD: Record<Leg, 'pb' | 'pt'> = { brent: 'pb', ttf: 'pt' }
const LEG_TITLE: Record<Leg, string> = { brent: 'Brent ≥ $120', ttf: 'TTF > €200/MWh' }
const LEG_UNIT: Record<Leg, string> = { brent: 'ICE, $/bbl', ttf: 'EUR/MWh' }
const THRESHOLD: Record<Leg, number> = { brent: 120, ttf: 200 }
const THRESHOLD_LABEL: Record<Leg, string> = { brent: '$120', ttf: '€200' }
const SIDE_LABEL: Record<Side, string> = { high: 'above threshold', uncertain: 'uncertain', low: 'does not expect' }
const SIDE_PILL: Record<Side, string> = {
  high: 'bg-teal-50 text-teal-800',
  uncertain: 'bg-amber-50 text-amber-800',
  low: 'bg-rose-50 text-rose-800',
}

interface Voice { n: number; name: string; role: string; note: string }
const CARDS: Record<Leg, { hit: Voice[]; miss: Voice[] }> = {
  brent: {
    hit: [
      { n: 174, name: 'JPMorgan', role: 'bank, via Business Insider', note: 'A conditional scenario, but with a number: $150. Published five weeks before the invasion.' },
      { n: 222, name: 'Jeffrey Halley', role: 'Oanda, via NPR', note: 'Two days before the invasion. Brent did close above $120 on 7 March.' },
    ],
    miss: [
      { n: 132, name: 'Deutsche Bank', role: 'bank, via Vedomosti', note: 'The lowest target in the corpus. Three months later Brent cost about $120.' },
      { n: 166, name: 'EIA', role: 'US Department of Energy', note: 'The official forecast six weeks before the invasion. Brent averaged about $100 in 2022.' },
    ],
  },
  ttf: {
    hit: [
      { n: 11, name: 'Alexey Miller', role: 'head of Gazprom, via Rossiyskaya Gazeta', note: 'The seller of the gas is speaking, and gives no number. P is high on direction, not on level.' },
      { n: 221, name: 'Dmitry Medvedev', role: 'Russian Security Council, via CNN Arabic', note: 'A threat and a forecast in one: EUR 2,000 per 1,000 m³ is roughly EUR 190/MWh, right at the threshold. Two weeks later it was crossed.' },
    ],
    miss: [
      { n: 181, name: 'ABN Amro', role: 'bank, via FXStreet', note: 'The right level, but the bank put the "Russia halts gas exports" scenario at 5-10%. The threshold was crossed without any halt.' },
      { n: 7, name: 'Gazprom', role: 'press office, via TASS', note: 'Three and a half months later, on 21 December, TTF closed at EUR 180, three times higher.' },
    ],
  },
}

const GAPS = [
  'Bloomberg, the Financial Times and the Wall Street Journal are barely represented: those sites did not appear in GDELT for the topic, and what exists in Wayback is mostly paywalled.',
  'Texts of 179 table articles come from live pages and 48 from the Wayback archive before 25 February. Live pages may have been edited, so articles with traces of later edits were dropped.',
  'Most articles name neither a price nor a probability. For them P is the model’s reading: “the winter will be very hard” gives clearly above 0.5, but does not prove the author had EUR 200 in mind. P should not be read as a calibrated probability.',
  'Ratings were set by a model. It sometimes mixes up the market (US gas instead of European) or takes a conditional scenario for a forecast. We manually removed clear US-gas cases and checked the cards above.',
  'Brent here is the ICE front-month future. Dated Brent spot on the same day, 8 March, was above $130, so a $130 threshold was not unambiguous; we used $120.',
]

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
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_TICKS: { t: number; label: string }[] = (() => {
  const out: { t: number; label: string }[] = []
  for (let y = 2021, m = 8; ; ) {
    const t = Date.UTC(y, m, 1)
    if (t > T1) break
    out.push({ t, label: MONTH_NAMES[m] })
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return out
})()
const LEGS: Leg[] = ['brent', 'ttf']

export default function EnergyRetroReport({ rows, pool, prices }: { rows: ReportRow[]; pool: PoolRow[]; prices: Prices }) {
  const total = useMemo(() => Object.fromEntries(LEGS.map(l => [l, agg(pool, l)])) as Record<Leg, Agg>, [pool])
  const agencyOil = useMemo(() => agg(pool.filter(r => r.g === 'agencies'), 'brent'), [pool])
  const pressGas = useMemo(() => agg(pool.filter(r => r.g === 'press'), 'ttf'), [pool])
  const bankGas = useMemo(() => agg(pool.filter(r => r.g === 'banks'), 'ttf').n, [pool])
  const agencyGas = useMemo(() => agg(pool.filter(r => r.g === 'agencies'), 'ttf').n, [pool])
  const byN = useMemo(() => new Map(rows.map(r => [r.n, r])), [rows])
  const unverified = rows.filter(r => !r.quote_verified).length

  const thesis: [string, string, string, string, string][] = [
    ['Brent', pct(total.brent.y), 'expect above', `Share of oil statements with P ≥ 0.6. Mean P across the whole pool ${total.brent.p.toFixed(2)}.`, '#2a78d6'],
    ['TTF', pct(total.ttf.y), 'expect above', `Share of gas statements with P ≥ 0.6. Mean P across the whole pool ${total.ttf.p.toFixed(2)}.`, '#eb6834'],
    ['Agencies', agencyOil.p.toFixed(2), 'mean P', `Mean P of agencies on oil, ${agencyOil.n} statements. ${pct(agencyOil.no)} expected a price below the threshold: the EIA gave about $70-75 a barrel.`, '#1baf7a'],
    ['Press, gas', pct(pressGas.y), 'expect above', `Share of press and analyst statements on gas with P ≥ 0.6, ${pressGas.n} statements. They expected a spike but most often named no number.`, '#eda100'],
  ]

  return (
    <div className="retro-light min-h-screen bg-[#f5f7fa] text-gray-800">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link href="/retroanalysis" className="text-xs font-bold tracking-widest uppercase text-gray-500 hover:text-gray-700">← Retro Analysis</Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono uppercase tracking-widest text-gray-600">
            <span>Case E03</span><span>Window 1 Sep 2021 → <b className="text-rose-700 font-medium">24 Feb 2022</b></span>
          </div>
          <h1 className="mt-4 text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-[1.05]">
            Who saw <span className="text-rose-700">$120 oil</span> and <span className="text-rose-700">€200 gas</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-gray-700 leading-relaxed">
            Six months before the invasion: {pool.length} statements by banks, agencies, companies and the press on oil and European gas prices.
            Each was read in full and rated separately on two questions: would Brent go above $120, and would TTF go above €200/MWh in 2022. Both thresholds were crossed on 7 March 2022.
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t-2 border-gray-900 border-b border-gray-200">
            {thesis.map(([who, big, unit, text, color], i) => (
              <div key={who} className={`py-5 pr-5 ${i > 0 ? 'lg:pl-5 lg:border-l border-gray-200 border-t sm:border-t-0' : ''} ${i === 1 || i === 3 ? 'sm:pl-5 sm:border-l' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''}`}>
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{who}
                </div>
                <div className="mt-2 text-4xl font-black text-gray-900 tabular-nums">{big}<span className="ml-1.5 text-sm font-normal text-gray-600">{unit}</span></div>
                <p className="mt-2 text-sm text-gray-700 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </header>

        <NumbersGuide />

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">What happened next</h2>
          <p className="mt-2 max-w-2xl text-gray-700">The black line is the front-month futures price: Brent (ICE) and TTF. The red dashed line is the question threshold. The grey band is the window in which we collected statements; whatever lies to the right, the authors did not yet know.</p>
          <div className="mt-5 space-y-6 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            {LEGS.map(l => (
              <div key={l}>
                <h3 className="font-bold text-gray-900">{l === 'brent' ? 'Brent' : 'TTF'}<span className="ml-2 font-mono text-xs font-normal text-gray-500">{LEG_UNIT[l]}</span></h3>
                <PriceChart leg={l} series={prices[l]} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-600">Front-month closing prices (Yahoo Finance, BZ=F and TTF=F). Brent: 11 closes above $120 in 2022, peak $127.98 (8 March). TTF: 30 closes above €200, peak €339 (26 August).</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who said what</h2>
          <p className="mt-2 max-w-2xl text-gray-700">A dot is one article; its height is the probability the main voice expressed. The line is the group mean over the previous 30 days, shown when the group has at least four articles.</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-gray-700 mb-2">
              {GROUPS.map(g => (
                <span key={g} className="inline-flex items-center gap-2"><i className="w-3.5 h-[3px] rounded" style={{ background: GROUP_COLOR[g] }} />{GROUP_NAME[g]} <span className="font-mono text-gray-500">{pool.filter(r => r.g === g).length}</span></span>
              ))}
              <span className="inline-flex items-center gap-2"><i className="w-2 h-2 rounded-full bg-gray-400/60" />one article</span>
            </div>
            {LEGS.map(l => (
              <div key={l} className="mt-4">
                <h3 className="font-bold text-gray-900">{LEG_TITLE[l]}</h3>
                <PChart leg={l} pool={pool} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-600">The dashed line at 50% separates “more likely than not” from “less likely”. The chart stops at the invasion: later statements are not part of the question.</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who got it right, who did not</h2>
          <p className="mt-2 max-w-2xl text-gray-700">The clearest statements on each question. The number on the left is the probability we assigned to them. Quotes are checked against the article text.</p>
          {LEGS.map(l => (
            <div key={l} className="mt-8">
              <h3 className="font-bold text-gray-900">{LEG_TITLE[l]}</h3>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <VoiceColumn title="Expected above the threshold" range="P ≥ 0.75" tone="hit" voices={CARDS[l].hit} leg={l} byN={byN} />
                <VoiceColumn title="Did not expect it" range="P ≤ 0.25" tone="miss" voices={CARDS[l].miss} leg={l} byN={byN} />
              </div>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who said yes, who said no</h2>
          <p className="mt-2 max-w-2xl text-gray-700">
            Shares of positions by type of main voice and by publication language. On oil, {pct(agencyOil.no)} of agency statements ({agencyOil.n}) expected a price below the threshold; banks and the press split almost evenly.
            On gas the corpus has almost no bank or agency statements ({bankGas} and {agencyGas}); the press did most of the talking, and {pct(pressGas.y)} of the time it expected a spike.
          </p>
          {LEGS.map(l => (
            <div key={l} className="mt-6">
              <h3 className="font-bold text-gray-900">{LEG_TITLE[l]}</h3>
              <div className="mt-3 grid gap-x-4 gap-y-3 items-center" style={{ gridTemplateColumns: 'minmax(140px,230px) 1fr 64px' }}>
                {GROUPS.map(g => <SplitRow key={g} label={GROUP_NAME[g]} a={agg(pool.filter(r => r.g === g), l)} />)}
                {REGIONS.map(k => <SplitRow key={k} label={REGION_NAME[k]} a={agg(pool.filter(r => r.r === k), l)} />)}
              </div>
            </div>
          ))}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-700">
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-teal-600" />expects above threshold, P ≥ 0.6</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-gray-300" />uncertain</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-rose-600" />does not expect, P ≤ 0.4</span>
            <span className="font-mono text-gray-500">right: mean P</span>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{rows.length} articles</h2>
          <p className="mt-2 max-w-2xl text-gray-700">A sample from the pool: at most 15 articles per outlet and 3 per speaker; sceptics raised to 45% so their arguments are visible. One article can speak about both markets. See <a href="#numbers" className="underline">how to read P</a>.</p>
          <ArticleTable rows={rows} />
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">How this was computed</h2>
          <div className="mt-5 grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <Method title="Search">A list of 146 domains: business and energy press, agencies, banks, think tanks, and Russian-language and European outlets. GDELT GKG via BigQuery returned 12,537 URLs with energy headlines. Bloomberg, the Financial Times and the Wall Street Journal did not turn up in GDELT for these topics.</Method>
            <Method title="Filter">Keywords and Claude Haiku on headlines: 2,551 candidates were narrowed to 817. Full texts were downloaded; 498 got a rating. We dropped irrelevant items, articles that only describe prices, and articles with traces of edits after 24 February. Dates were checked against the page itself for every year, not only 2021-2022.</Method>
            <Method title="Rating" formula="P = 0.5 + 0.5 × position">The model reads the text as of the publication date and returns the main voice&apos;s position from −1 to +1 separately for each question. When a price is named, a fixed rule applies: for example a Brent forecast below $90 gives −0.6, $105-119 gives −0.1, $130 and above gives +0.6; the article&apos;s tone shifts it by at most 0.2. If the speaker stated a probability, that is used.</Method>
            <Method title="Whose voice">P belongs to the article&apos;s main voice, not to the outlet or the author: a TASS item on Gazprom&apos;s words gets Gazprom&apos;s P. P of 0.6 or more is “expects above the threshold”, P of 0.4 or less is “does not expect”.</Method>
          </div>
          <h3 className="mt-10 text-lg font-extrabold text-gray-900">What is missing</h3>
          <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-700 max-w-3xl">
            {GAPS.map(g => <li key={g}>{g}</li>)}
            <li>{unverified} of {rows.length} quotes were not found verbatim in the text. These are the model&apos;s paraphrase and are marked in the table.</li>
          </ul>
        </section>

        <div className="mt-16 text-center text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">DAATAN Retro-Analysis Archive · E03 · built 15 Oct 2026</div>
      </div>
      <ScrollNav />
    </div>
  )
}

const SCALE_MARKS: [number, string][] = [
  [0.2, 'EIA: $75'],
  [0.5, 'No view'],
  [0.75, 'JPMorgan: $150'],
]

function NumbersGuide() {
  return (
    <section id="numbers" className="mt-12 scroll-mt-6">
      <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">How to read P</h2>
      <p className="mt-2 max-w-2xl text-gray-700">Every article gets up to two numbers, <b className="text-gray-900">P</b>: what its main voice expected about each market at the time, before anyone knew the outcome.</p>
      <div className="mt-6 max-w-3xl">
        <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
          <div className="flex items-baseline gap-3"><span className="text-3xl font-black text-gray-900">P</span><span className="text-sm text-gray-600">0 to 1 · what the speaker expected</span></div>
          <p className="mt-3 text-[15px] text-gray-700 leading-relaxed">
            One P for oil: the probability that Brent settles <b className="text-gray-900">at or above $120</b> in 2022. One P for gas: that TTF settles <b className="text-gray-900">above €200/MWh</b>. The two are independent and never combined. 0 means “certainly not”, 1 means “certainly yes”, 0.5 means no view either way.
          </p>
          <div className="relative mt-14 mb-12 mx-2">
            <div className="h-2 rounded-full bg-gradient-to-r from-rose-500 via-gray-300 to-teal-600" />
            {SCALE_MARKS.map(([p, who], i) => (
              <div key={who} className={`absolute flex flex-col w-40 whitespace-nowrap -translate-x-1/2 items-center text-center ${i % 2 ? 'top-3' : 'bottom-3 flex-col-reverse'}`} style={{ left: `${p * 100}%` }}>
                <span className="w-px h-2.5 bg-gray-500" />
                <span className="font-mono text-[11px] text-gray-900 font-medium">{p.toFixed(2)} {who}</span>
              </div>
            ))}
            <span className="absolute -left-2 top-3 font-mono text-[11px] text-gray-500">0</span>
            <span className="absolute -right-2 top-3 font-mono text-[11px] text-gray-500">1</span>
          </div>
          <ul className="space-y-1.5 text-[14px] text-gray-700 leading-relaxed list-disc pl-5">
            <li>The model rates the speaker&apos;s position from −1 to +1, and <span className="font-mono text-gray-900">P = 0.5 + 0.5 × position</span>.</li>
            <li>Most articles name no price, so P is mostly directional: “prices will keep climbing” reads clearly above 0.5 without saying how high. It is not a calibrated probability.</li>
            <li>P ≥ 0.6 counts as “expects above the threshold” and P ≤ 0.4 as “does not”. <b className="text-gray-900">Mean P</b> is the average over a group&apos;s statements.</li>
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
  const seg = (cls: string, v: number, text: string) => v > 0 && (
    <span className={`flex items-center justify-center overflow-hidden whitespace-nowrap font-mono text-xs font-medium first:rounded-l last:rounded-r ${cls}`} style={{ flex: v }} title={`${text} ${pct(v)}`}>{v >= 0.09 ? pct(v) : ''}</span>
  )
  return (
    <>
      <div className="text-sm leading-tight">{label}<span className="block font-mono text-xs text-gray-500">{a.n} articles</span></div>
      <div className="flex h-6 gap-[2px]" role="img" aria-label={`${label}: expects above ${pct(a.y)}, uncertain ${pct(a.u)}, does not ${pct(a.no)}`}>
        {seg('bg-teal-600 text-white', a.y, 'expects above')}
        {seg('bg-gray-300 text-gray-800', a.u, 'uncertain')}
        {seg('bg-rose-600 text-white', a.no, 'does not')}
      </div>
      <div className="text-right font-mono text-[15px] font-medium tabular-nums">{a.p.toFixed(2)}<span className="block text-[11px] text-gray-500">mean P</span></div>
    </>
  )
}

function VoiceColumn({ title, range, tone, voices, leg, byN }: { title: string; range: string; tone: 'hit' | 'miss'; voices: Voice[]; leg: Leg; byN: Map<number, ReportRow> }) {
  const color = tone === 'hit' ? 'text-teal-700 border-teal-700' : 'text-rose-700 border-rose-700'
  return (
    <div>
      <div className={`flex items-baseline justify-between border-b-2 pb-1.5 ${color}`}>
        <h4 className="text-lg font-extrabold">{title}</h4><span className="font-mono text-xs">{range}</span>
      </div>
      {voices.map(v => {
        const r = byN.get(v.n)
        if (!r) return null
        const p = leg === 'brent' ? r.p_brent : r.p_ttf
        return (
          <article key={v.n} className="grid grid-cols-[64px_1fr] gap-x-4 py-4 border-b border-gray-200">
            <div className={`row-span-3 text-2xl font-black tabular-nums ${tone === 'hit' ? 'text-teal-700' : 'text-rose-700'}`}>
              {p == null ? '—' : p.toFixed(2)}
              <span className="block mt-1 font-mono text-[10px] font-normal text-gray-500">P</span>
            </div>
            <div className="font-mono text-xs text-gray-500">{r.date.split('-').reverse().join('.')} · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">{r.domain}</a></div>
            <div className="font-bold text-gray-900 leading-snug">{v.name}<span className="block font-normal text-sm text-gray-600">{v.role}</span></div>
            <div>
              <blockquote className="mt-1.5 italic text-gray-800 leading-relaxed">“{r.key_quote_en ?? r.key_quote}”</blockquote>
              <p className="mt-1.5 text-sm text-gray-600">{v.note}</p>
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
    <div ref={box} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={`${leg === 'brent' ? 'Brent' : 'TTF'} front-month price, September 2021 to December 2022`}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          <rect x={x(T0)} y={T} width={x(TW) - x(T0)} height={H - T - B} fill="#e5e7eb" fillOpacity={0.6} />
          {grid.map(v => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#eceff3" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </g>
          ))}
          {MONTH_TICKS.map(m => (
            <g key={m.t}>
              <line x1={x(m.t)} x2={x(m.t)} y1={T} y2={H - B} stroke="#eceff3" />
              {(!narrow || MONTH_TICKS.indexOf(m) % 2 === 0) && <text x={x(m.t) + 3} y={H - 6}>{m.label}</text>}
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(THRESHOLD[leg])} y2={y(THRESHOLD[leg])} stroke="#be123c" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={W - R - 4} y={y(THRESHOLD[leg]) - 5} textAnchor="end" fill="#be123c" fontWeight={500}>{THRESHOLD_LABEL[leg]}</text>
          <path d={d} fill="none" stroke="#111827" strokeWidth={1.8} />
          <line x1={x(TW)} x2={x(TW)} y1={T} y2={H - B} stroke="#be123c" strokeWidth={1.5} />
          <text x={x(TW) + 5} y={T + 12} fill="#be123c">24 Feb 2022</text>
          <text x={x(T0) + 4} y={T + 12}>collection window</text>
        </g>
      </svg>
    </div>
  )
}

function PChart({ leg, pool }: { leg: Leg; pool: PoolRow[] }) {
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
    <div ref={box} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label={`Mean probability for ${LEG_TITLE[leg]} by group of voices, September 2021 to February 2022`}>
        <g className="font-mono" fontSize={11.5} fill="#4b5563">
          <rect x={x(T0)} y={T} width={x(TW) - x(T0)} height={H - T - B} fill="#e5e7eb" fillOpacity={0.35} />
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? '#6b7280' : '#eceff3'} strokeDasharray={p === 0.5 ? '3 4' : undefined} />
              <text x={L - 6} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
            </g>
          ))}
          {MONTH_TICKS.filter(m => m.t <= TX).map(m => (
            <g key={m.t}>
              <line x1={x(m.t)} x2={x(m.t)} y1={T} y2={H - B} stroke="#eceff3" />
              <text x={x(m.t) + 3} y={H - 6}>{m.label}</text>
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
        <text x={x(TW) + 5} y={T + 12} className="font-mono" fontSize={11.5} fill="#be123c">24 Feb 2022</text>
        {labels.map(l => (
          <text key={l.g} x={x(TW) + 6} y={l.ly + 14} fontSize={narrow ? 10.5 : 12} fontWeight={700} fill={GROUP_COLOR[l.g]}>{GROUP_SHORT[l.g]} {Math.round(l.m * 100)}</text>
        ))}
      </svg>
    </div>
  )
}

type SortKey = 'n' | 'date' | 'voice_name' | 'p_brent' | 'p_ttf'
type LegFilter = '' | Leg

function PBar({ p, price, unit }: { p: number | null; price: number | null; unit: string }) {
  if (p == null) return <span className="text-gray-400">—</span>
  const s = sideOf(p)
  return (
    <div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="relative w-16 h-1.5 bg-gray-100 rounded"><span className="absolute inset-y-0 left-0 rounded bg-gray-700" style={{ width: `${p * 100}%` }} /><span className="absolute -inset-y-0.5 left-1/2 w-px bg-gray-400" /></span>
        <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${SIDE_PILL[s]}`}>{p.toFixed(2)}</span>
      </div>
      {price != null && <div className="mt-0.5 font-mono text-xs text-gray-500">price estimate: {price} {unit}</div>}
    </div>
  )
}

function ArticleTable({ rows }: { rows: ReportRow[] }) {
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
    <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`} aria-sort={sortK === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)} className="uppercase">{label}{sortK === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>{sub && <span className="block normal-case tracking-normal font-sans text-[11px] font-normal text-gray-500">{sub}</span>}
    </th>
  )
  const sel = 'bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-sm text-gray-800 min-w-[150px]'
  const lbl = 'flex flex-col gap-1 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-600'

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className={lbl}>Market<select className={sel} value={fLeg} onChange={e => setFLeg(e.target.value as LegFilter)}><option value="">both</option><option value="brent">oil</option><option value="ttf">gas</option></select></label>
        <label className={lbl}>Voice<select className={sel} value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">all</option>{GROUPS.map(g => <option key={g} value={g}>{GROUP_NAME[g]}</option>)}</select></label>
        <label className={lbl}>Position<select className={sel} value={fSide} onChange={e => setFSide(e.target.value)}><option value="">all</option><option value="high">{SIDE_LABEL.high}</option><option value="uncertain">{SIDE_LABEL.uncertain}</option><option value="low">{SIDE_LABEL.low}</option></select></label>
        <label className={lbl}>Outlet<select className={sel} value={fReg} onChange={e => setFReg(e.target.value)}><option value="">all</option>{REGIONS.map(k => <option key={k} value={k}>{REGION_NAME[k]}</option>)}</select></label>
        <label className={lbl}>Search<input type="search" className={`${sel} min-w-[210px]`} placeholder="name, outlet, word" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="ml-auto font-mono text-xs text-gray-600">{shown.length} of {rows.length}</span>
      </div>
      <ul className="md:hidden space-y-3">
        {shown.map(r => (
          <li key={r.n} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-gray-600">
              <span>#{r.n} · {r.date}</span>
              <span className="flex gap-1.5">
                {r.p_brent != null && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${SIDE_PILL[sideOf(r.p_brent)]}`}>Brent {r.p_brent.toFixed(2)}</span>}
                {r.p_ttf != null && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${SIDE_PILL[sideOf(r.p_ttf)]}`}>TTF {r.p_ttf.toFixed(2)}</span>}
              </span>
            </div>
            <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="mt-2 block font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
            <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ' · archive' : ''}</div>
            <div className="mt-2 text-sm text-gray-800">
              <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: GROUP_COLOR[r.g] }} title={GROUP_NAME[r.g]} />
              {r.voice_name || '—'}{r.voice_affiliation && <span className="text-gray-600"> · {r.voice_affiliation}</span>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-gray-700 leading-snug">{r.summary}</summary>
              <blockquote className="mt-2 pl-2.5 border-l-2 border-gray-200 italic text-[13px] text-gray-800">
                {r.key_quote_en}
                {r.key_quote && r.key_quote !== r.key_quote_en && <span dir="auto" className="block mt-1 text-gray-500">{r.key_quote}</span>}
              </blockquote>
              {!r.quote_verified && <div className="mt-1 font-mono text-[11px] text-amber-700">quote not found verbatim</div>}
            </details>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead><tr>
            {th('n', '#', true)}{th('date', 'Date')}
            <th className={`${thCls} text-left`}>Article</th>
            {th('voice_name', 'Main voice', false, 'who is quoted, not the author')}{th('p_brent', 'P Brent')}{th('p_ttf', 'P TTF')}
            <th className={`${thCls} text-left`}>Summary & quote</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.n} className="align-top border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.n}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2.5 min-w-[240px] max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
                  <div className="mt-0.5 font-mono text-xs text-gray-500">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ' · archive' : ''}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: GROUP_COLOR[r.g] }} title={GROUP_NAME[r.g]} />
                  {r.voice_name || '—'}<span className="block text-xs text-gray-500 leading-snug">{r.voice_affiliation}</span>
                </td>
                <td className="px-3 py-2.5"><PBar p={r.p_brent} price={r.price_brent} unit="$" /></td>
                <td className="px-3 py-2.5"><PBar p={r.p_ttf} price={r.price_ttf} unit="€" /></td>
                <td className="px-3 py-2.5 min-w-[260px] max-w-[420px]">
                  <details>
                    <summary className="cursor-pointer text-[13px] text-gray-700 leading-snug">{r.summary}</summary>
                    <blockquote className="mt-2 pl-2.5 border-l-2 border-gray-200 italic text-[13px] text-gray-800">
                      {r.key_quote_en}
                      {r.key_quote && r.key_quote !== r.key_quote_en && <span dir="auto" className="block mt-1 text-gray-500">{r.key_quote}</span>}
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
