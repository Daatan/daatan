'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, PollSeats, PoolRow, Region, ReportRow, Side } from './types'

const GROUPS: Group[] = ['polls', 'media', 'bloc', 'anti']
const GROUP_NAME: Record<Group, string> = {
  polls: 'Seat polls',
  media: 'Analysts & press',
  bloc: 'Bloc politicians',
  anti: 'Opposition politicians',
}
const GROUP_SHORT: Record<Group, string> = { polls: 'Polls', media: 'Press', bloc: 'Bloc', anti: 'Opposition' }
const GROUP_COLOR: Record<Group, string> = { polls: '#2a78d6', media: '#1baf7a', bloc: '#eb6834', anti: '#eda100' }
const REGIONS: Region[] = ['he', 'il_en', 'ru', 'ar', 'intl']
const REGION_NAME: Record<Region, string> = {
  he: 'Israeli, Hebrew',
  il_en: 'Israeli & Jewish, English',
  ru: 'Russian-language',
  ar: 'Arabic-language',
  intl: 'International',
}
const SIDE_LABEL: Record<Side, string> = { bloc61: 'expects 61+', uncertain: 'unsure', no61: "doesn't" }
const SIDE_PILL: Record<Side, string> = {
  bloc61: 'bg-teal-50 text-teal-800',
  uncertain: 'bg-amber-50 text-amber-800',
  no61: 'bg-rose-50 text-rose-800',
}
const NO61: Record<string, string> = {
  deadlock: 'deadlock, new election',
  opposition_forms_govt: 'opposition government',
  unity_govt: 'unity government',
  unclear: 'unclear',
}
const EVENTS: [string, string][] = [
  ['2022-06-20', 'Bennett and Lapid announce the Knesset will dissolve'],
  ['2022-06-30', 'Knesset dissolved, Lapid becomes prime minister'],
  ['2022-07-10', 'Gantz and Sa’ar merge their parties'],
  ['2022-08-14', 'Eisenkot joins Gantz: National Unity'],
  ['2022-09-15', 'List deadline: the Joint List splits'],
  ['2022-10-11', 'Maritime border deal with Lebanon'],
]

interface Voice { n: number; name: string; role: string; quote: string; note?: string }
const HIT: Voice[] = [
  { n: 203, name: 'Nadav Eyal', role: 'Yedioth Ahronoth, translated in Al-Quds Al-Arabi', quote: 'Since the start of the campaign, Netanyahu has not been closer to victory than he is now, thanks to Sami Abu Shehada and his colleagues, of course.', note: 'Written three days after Balad left the Joint List. Balad fell below the threshold, and the wasted votes helped the bloc to its majority.' },
  { n: 235, name: 'Amit Segal', role: 'Yedioth Ahronoth, reported by Kikar HaShabbat', quote: 'Netanyahu could theoretically reach 63 seats even if his camp wins less than half the votes.', note: 'He described the mechanism exactly. In the same piece he reported internal polls giving Netanyahu 59 (Lapid’s pollster) and 60.5 (Netanyahu’s own).' },
  { n: 275, name: 'Yuval Karni', role: 'Yedioth Ahronoth, translated in Al-Quds Al-Arabi', quote: 'A 61-seat government headed by Netanyahu is the scenario with the highest likelihood of materializing.', note: 'Four days before the vote. His six scenarios also included deadlock and a sixth election.' },
  { n: 90, name: 'Joel Rosenberg', role: 'Editor-in-chief, All Israel News', quote: "If I were a betting man at one of Trump's casinos, I would probably put my money 60-40 on Netanyahu to come back.", note: 'One of the few explicit odds in the corpus, given in July, right after the Knesset dissolved. That is why P is 0.60.' },
]
const MISS: Voice[] = [
  { n: 37, name: 'Noga Tarnopolsky', role: 'Journalist, Atlantic Council', quote: 'Netanyahu has no evident path back... the most likely outcome should the Bennett-Lapid coalition fall [is] additional cycles of inconclusive elections.', note: 'Published three days before the coalition did fall.' },
  { n: 171, name: 'Ze’ev Elkin', role: 'New Hope, National Unity', quote: 'Netanyahu almost never reaches 61 seats in any poll... Netanyahu will not get 61 seats this time.', note: 'The core message of the Gantz–Sa’ar campaign. Said in Russian to Channel 7.' },
  { n: 285, name: 'Bobby Ghosh', role: 'Bloomberg, translated in Al-Quds Al-Arabi', quote: 'The closest bet is holding a sixth election.', note: 'The day before the vote.' },
  { n: 287, name: 'Shalom Lipner', role: 'Atlantic Council, in Foreign Policy', quote: "Even more likely than this bleak scenario materializing is the correspondingly precarious outcome of Israelis being dragged to another sixth ballot in a few months' time.", note: 'The “bleak scenario” is a Netanyahu government with Ben-Gvir. Published 31 October.' },
]

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
  const byGroup = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, agg(pool.filter(r => r.g === g))])) as Record<Group, Agg>, [pool])
  const byRegion = useMemo(() => Object.fromEntries(REGIONS.map(k => [k, agg(pool.filter(r => r.r === k))])) as Record<Region, Agg>, [pool])
  const byN = useMemo(() => new Map(rows.map(r => [r.n, r])), [rows])
  const unverified = rows.filter(r => !r.quote_verified).length

  const oct = polls.filter(r => r.d >= '2022-10-01')
  const octUnder = oct.filter(r => r.s < 61).length / Math.max(1, oct.length)
  const thesis: [Group, string, string, string][] = [
    ['polls', pct(octUnder), 'below 61', 'Share of October poll reports that left the bloc short of a majority. The most common figure was 60.'],
    ['media', pct(byGroup.media.p), 'mean P', `Analysts and journalists split, but “no” came up more often: ${pct(byGroup.media.no)} against ${pct(byGroup.media.y)}.`],
    ['bloc', pct(byGroup.bloc.y), 'say “yes”', 'Likud and its partners promised 61, though many in the camp conceded the polls were a seat or two short.'],
    ['anti', pct(byGroup.anti.no), 'say “no”', `Lapid, Gantz and their allies ran on “Netanyahu has no 61”. Their mean P was ${pct(byGroup.anti.p)}.`],
  ]

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-gray-800">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link href="/retroanalysis" className="text-xs font-bold tracking-widest uppercase text-gray-400 hover:text-gray-700">← Retro Analysis</Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono uppercase tracking-widest text-gray-500">
            <span>Case E02</span><span>Window 1 May → <b className="text-rose-700 font-medium">1 Nov 2022</b></span>
          </div>
          <h1 className="mt-4 text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-[1.05]">
            Who saw <span className="text-rose-700">64 seats</span> coming
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-gray-600 leading-relaxed">
            The six months before Israel&apos;s 25th Knesset election: {pool.length.toLocaleString('en-US')} statements from the Israeli press in Hebrew, English, Russian and Arabic, world media and think tanks.
            Each article was read in full and rated on one question: how likely did its main voice think it was that Netanyahu&apos;s bloc (Likud, Religious Zionism, Shas, United Torah Judaism) would win 61 seats? The bloc won 64.
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

        <NumbersGuide />

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Polls against the ballot box</h2>
          <p className="mt-2 max-w-2xl text-gray-600">Each bubble counts poll reports that gave the bloc that many seats. For six months the median sat at 59–60, one or two short of a majority. On election day the bloc won 64: Meretz and Balad fell below the threshold and their votes were wasted.</p>
          <div className="mt-5 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-5">
            <PollChart polls={polls} />
          </div>
          <p className="mt-3 text-xs text-gray-500">{polls.length} articles that give a seat total for the bloc. Several outlets often reported the same poll, so this measures weight in the news, not the number of distinct polls.</p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Six months of argument in one chart</h2>
          <p className="mt-2 max-w-2xl text-gray-600">Each dot is one article, placed at the probability of 61+ seats its main voice expressed. Each line is that group&apos;s mean over the previous 14 days: what a reader could have seen at the time, without hindsight.</p>
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
          <p className="mt-2 max-w-2xl text-gray-600">The clearest calls on both sides. The number is the probability we assigned. Quotes are checked against the article text; Hebrew and Arabic ones are translated.</p>
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <VoiceColumn title="Expected 61+" range="P ≥ 0.6" tone="hit" voices={HIT} byN={byN} />
            <VoiceColumn title="Did not expect it" range="P ≤ 0.25" tone="miss" voices={MISS} byN={byN} />
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Who said “yes”, who said “no”</h2>
          <p className="mt-2 max-w-2xl text-gray-600">Share of positions by type of voice and by the outlet&apos;s language. Politicians in both camps predictably said what suited them. The press split almost evenly, and language made little difference: Hebrew, Russian and Arabic outlets all leaned slightly towards deadlock.</p>
          <div className="mt-6 grid gap-x-4 gap-y-3 items-center" style={{ gridTemplateColumns: 'minmax(140px,230px) 1fr 64px' }}>
            <SplitHeader label="By voice" />
            {GROUPS.map(g => <SplitRow key={g} label={GROUP_NAME[g]} a={byGroup[g]} />)}
            <SplitHeader label="By outlet language" />
            {REGIONS.map(k => <SplitRow key={k} label={REGION_NAME[k]} a={byRegion[k]} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-600">
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-teal-600" />expects 61+, P ≥ 0.6</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-gray-300" />unsure</span>
            <span className="inline-flex items-center gap-2"><i className="w-3 h-3 rounded-sm bg-rose-600" />does not, P ≤ 0.4</span>
            <span className="font-mono text-gray-400">right: mean P</span>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{rows.length} articles</h2>
          <p className="mt-2 max-w-2xl text-gray-600">A balanced sample of the pool: at most 15 articles per outlet and 3 per speaker, polls capped at 30% and one per pollster a week, sceptics raised to 35% so their arguments stay visible. See <a href="#numbers" className="underline">how to read P</a>.</p>
          <ArticleTable rows={rows} />
        </section>

        <section className="mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Method</h2>
          <div className="mt-5 grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <Method title="Search">A seed list of 326 domains: news-indexer sources, the Israeli press in Hebrew, English, Russian and Arabic, world outlets, think tanks and pollsters. GDELT GKG via BigQuery returned 20,245 URLs from 157 of them. Israel Hayom, Haaretz English, NewsRu.co.il, INSS, JPPI and others missing from GDELT were added from the Wayback archive.</Method>
            <Method title="Filter">Keywords in four languages, then Claude Haiku on titles: 2,261 of 8,780 candidates kept. Full texts then dropped irrelevant pieces, repeats of one speaker on one day, repeats of one pollster in one week, and anything edited after 1 November. Articles whose page date falls in an earlier campaign (2019–2021) were dropped, 37 of them. A second pass dropped 33 spring-2022 articles where “61” was about the current Knesset (no-confidence votes, defections, an alternative government), not the election. Dates were checked against the page itself.</Method>
            <Method title="Rating" formula="P = 0.5 + 0.5 × stance">The model reads the text as of its publication date and returns the main voice&apos;s stance from −1 to +1, confidence, the bloc&apos;s seat total if given, and a verbatim quote. For seat polls the stance follows a fixed rule: ≤58 seats −0.6, 59 −0.4, 60 −0.2, 61–62 +0.3, ≥63 +0.6. The article&apos;s framing can shift it by up to 0.2. The main voice is whoever the article quotes on the question, not the author.</Method>
          </div>
          <h3 className="mt-10 text-lg font-extrabold text-gray-900">What is missing</h3>
          <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600 max-w-3xl">
            <li>N12, Kan and Channel 13 are barely represented: their sites are absent from GDELT and Wayback lists their articles without titles. Israeli TV, where much of the forecasting happened, is not covered.</li>
            <li>About two thirds of Hebrew Israel Hayom articles for the window were fetched. Hebrew Haaretz, Walla and Ynet appear only through GDELT.</li>
            <li>253 texts come from live pages and 47 from Wayback snapshots taken before 1 November.</li>
            <li>{unverified} of {rows.length} quotes were not found verbatim in the text. They are model paraphrases and are flagged in the table.</li>
            <li>Ratings are by the model. It sometimes misplaces a speaker&apos;s camp or reads a conditional “if Netanyahu gets 61” as a forecast, so some table rows are wrong. The cards above and about 40 rows were checked by hand.</li>
          </ul>
        </section>

        <div className="mt-16 text-center text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">DAATAN Retro-Analysis Archive · E02 · built 24 Sep 2026</div>
      </div>
    </div>
  )
}

const SCALE_MARKS: [number, string, string][] = [
  [0.15, 'Elkin', '“will not get 61”'],
  [0.3, 'Poll: 59', 'one poll, two short'],
  [0.5, 'Coin flip', 'no view either way'],
  [0.65, 'Poll: 61', 'one poll, just enough'],
  [0.82, 'Eyal', '“never closer to victory”'],
]

function NumbersGuide() {
  return (
    <section id="numbers" className="mt-12 scroll-mt-6">
      <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">How to read P</h2>
      <p className="mt-2 max-w-2xl text-gray-600">Every article gets one number, <b className="text-gray-900">P</b>: what its main voice expected at the time, before anyone knew the outcome.</p>
      <div className="mt-6 max-w-3xl">
        <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
          <div className="flex items-baseline gap-3"><span className="text-3xl font-black text-gray-900">P</span><span className="text-sm text-gray-500">0 to 1 · what the speaker expected</span></div>
          <p className="mt-3 text-[15px] text-gray-600 leading-relaxed">The probability that Netanyahu&apos;s bloc wins <b className="text-gray-900">61 or more</b> seats, as the article&apos;s main voice expressed it on the day of publication. 0 means “certainly not”, 1 means “certainly yes”, 0.5 means no view either way.</p>
          <div className="relative mt-20 mb-16 mx-2">
            <div className="h-2 rounded-full bg-gradient-to-r from-rose-500 via-gray-300 to-teal-600" />
            {SCALE_MARKS.map(([p, who, what], i) => (
              <div key={who} className={`absolute flex flex-col w-28 ${p < 0.15 ? '-translate-x-[6px] items-start text-left' : p > 0.85 ? '-translate-x-[calc(100%-6px)] items-end text-right' : '-translate-x-1/2 items-center text-center'} ${i % 2 ? 'top-3' : 'bottom-3 flex-col-reverse'}`} style={{ left: `${p * 100}%` }}>
                <span className="w-px h-2.5 bg-gray-500" />
                <span className="font-mono text-[11px] text-gray-900 font-medium">{p.toFixed(2)} {who}</span>
                <span className="text-[11px] leading-tight text-gray-500">{what}</span>
              </div>
            ))}
            <span className="absolute -left-2 top-3 font-mono text-[11px] text-gray-400">0</span>
            <span className="absolute -right-2 top-3 font-mono text-[11px] text-gray-400">1</span>
          </div>
          <ul className="space-y-1.5 text-[14px] text-gray-600 leading-relaxed list-disc pl-5">
            <li>The model rates the speaker&apos;s stance from −1 to +1, and <span className="font-mono text-gray-900">P = 0.5 + 0.5 × stance</span>.</li>
            <li>A poll that gives the bloc 60 seats lands at P = 0.4, and 61–62 seats at 0.65. The article&apos;s framing can move it by up to 0.1 in P.</li>
            <li>P ≥ 0.6 counts as “expects 61+” and P ≤ 0.4 as “doesn’t”. <b className="text-gray-900">Mean P</b> is the average over a group’s statements.</li>
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
              {r.p61.toFixed(2)}
              <span className="block mt-1 font-mono text-[10px] font-normal text-gray-400">P 61+</span>
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

  const months: [string, string][] = [['2022-06-01', 'Jun'], ['2022-07-01', 'Jul'], ['2022-08-01', 'Aug'], ['2022-09-01', 'Sep'], ['2022-10-01', 'Oct']]
  const hx = tip ? x(days[tip.i]) : 0

  return (
    <div ref={box} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label="Mean probability of a 61-seat majority for Netanyahu's bloc by group of voices, May to October 2022">
        <g className="font-mono" fontSize={11.5} fill="#6b7280">
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={L} x2={x(T1)} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? '#6b7280' : '#eceff3'} strokeDasharray={p === 0.5 ? '3 4' : undefined} />
              <text x={L - 8} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
            </g>
          ))}
          <text x={x(T0) + 4} y={H - 6}>May</text>
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
        <text x={x(T1)} y={H - 6} textAnchor="middle" className="font-mono" fontSize={11.5} fill="#be123c" fontWeight={500}>1 Nov</text>
        {labels.map(l => (
          <text key={l.g} x={x(T1) + 6} y={l.ly + 4} fontSize={narrow ? 11 : 12.5} fontWeight={700} fill={GROUP_COLOR[l.g]}>{GROUP_SHORT[l.g]} {Math.round(l.m * 100)}%</text>
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

type SortKey = 'n' | 'date' | 'voice_name' | 'p61' | 'projected_bloc_seats'

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
    else { setSortK(k); setDir(k === 'p61' ? -1 : 1) }
  }
  const th = (k: SortKey, label: string, right = false, sub?: string) => (
    <th className={`sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      aria-sort={sortK === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)} className="uppercase">{label}{sortK === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>{sub && <span className="block normal-case tracking-normal font-sans text-[11px] font-normal text-gray-400">{sub}</span>}
    </th>
  )
  const sel = 'bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-sm text-gray-800 min-w-[150px]'
  const lbl = 'flex flex-col gap-1 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500'

  return (
    <>
      <div className="mt-6 mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <label className={lbl}>Voice<select className={sel} value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">all</option>{GROUPS.map(g => <option key={g} value={g}>{GROUP_NAME[g]}</option>)}</select></label>
        <label className={lbl}>Position<select className={sel} value={fSide} onChange={e => setFSide(e.target.value)}><option value="">all</option><option value="bloc61">expects 61+</option><option value="uncertain">unsure</option><option value="no61">does not</option></select></label>
        <label className={lbl}>Outlet<select className={sel} value={fReg} onChange={e => setFReg(e.target.value)}><option value="">all</option>{REGIONS.map(k => <option key={k} value={k}>{REGION_NAME[k]}</option>)}</select></label>
        <label className={lbl}>Search<input type="search" className={`${sel} min-w-[210px]`} placeholder="name, outlet, word" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="ml-auto font-mono text-xs text-gray-500">{shown.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead><tr>
            {th('n', '#', true)}{th('date', 'Date')}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 text-left">Article</th>
            {th('voice_name', 'Main voice', false, 'quoted speaker, not the author')}{th('p61', 'P 61+')}{th('projected_bloc_seats', 'Bloc seats', true)}
            <th className="sticky top-0 bg-white px-3 py-2.5 border-b border-gray-200 font-mono text-[11px] font-medium uppercase tracking-wider text-gray-500 text-left">Summary & quote</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.n} className="align-top border-b border-gray-100 last:border-0">
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.n}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2.5 min-w-[240px] max-w-[340px]">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" dir="auto" className="font-semibold text-gray-900 hover:underline leading-snug">{r.title || r.url}</a>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">{r.domain} · {r.article_kind}{r.text_source === 'wayback' ? ' · archived' : ''}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[150px] max-w-[220px]">
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: GROUP_COLOR[r.g] }} title={GROUP_NAME[r.g]} />
                  {r.voice_name || '—'}<span className="block text-xs text-gray-400 leading-snug">{r.voice_affiliation}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="relative w-16 h-1.5 bg-gray-100 rounded"><span className="absolute inset-y-0 left-0 rounded bg-gray-700" style={{ width: `${r.p61 * 100}%` }} /><span className="absolute -inset-y-0.5 left-1/2 w-px bg-gray-400" /></span>
                    <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${SIDE_PILL[r.side]}`}>{r.p61.toFixed(2)} {SIDE_LABEL[r.side]}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">confidence {(r.claim_strength ?? 0).toFixed(2)}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.projected_bloc_seats ?? '—'}<div className="font-sans text-xs text-gray-400">{r.side === 'no61' ? NO61[r.no61_kind ?? ''] : ''}</div></td>
                <td className="px-3 py-2.5 min-w-[260px] max-w-[420px]">
                  <details>
                    <summary className="cursor-pointer text-[13px] text-gray-600 leading-snug">{r.summary}</summary>
                    <blockquote className="mt-2 pl-2.5 border-l-2 border-gray-200 italic text-[13px] text-gray-800">
                      {r.key_quote_en}
                      {r.key_quote && r.key_quote !== r.key_quote_en && <span dir="auto" className="block mt-1 text-gray-400">{r.key_quote}</span>}
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

const MONTHS: [string, string][] = [['2022-05', 'May'], ['2022-06', 'Jun'], ['2022-07', 'Jul'], ['2022-08', 'Aug'], ['2022-09', 'Sep'], ['2022-10', 'Oct']]
const S0 = 55, S1 = 66

function PollChart({ polls }: { polls: PollSeats[] }) {
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
  }, [polls])

  const narrow = width < 560
  const W = width, L = narrow ? 40 : 54, R = 14, T = 30, rowH = narrow ? 34 : 40, H = T + MONTHS.length * rowH + 30
  const x = (v: number) => L + (v - S0 + 0.5) / (S1 - S0 + 1) * (W - L - R)
  const y = (i: number) => T + i * rowH + rowH / 2
  const rMax = Math.min(rowH / 2 - 2, (W - L - R) / (S1 - S0 + 1) / 2 - 1)
  const seatLabel = (v: number) => (v === S0 ? `≤${v}` : v === S1 ? `≥${v}` : `${v}`)
  const seats = Array.from({ length: S1 - S0 + 1 }, (_, i) => S0 + i)

  return (
    <div ref={box} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto overflow-visible" role="img" aria-label="Seats given to Netanyahu's bloc in poll reports, by month">
        <g className="font-mono" fontSize={11.5} fill="#6b7280">
          {seats.filter(v => !narrow || v % 2 === 1).map(v => <text key={v} x={x(v)} y={H - 8} textAnchor="middle">{seatLabel(v)}</text>)}
          <line x1={x(60.5)} x2={x(60.5)} y1={T - 10} y2={H - 24} stroke="#4b5563" strokeDasharray="4 4" />
          <text x={x(60.5) - 4} y={T - 14} textAnchor="end">&lt; 61 no majority</text>
          <line x1={x(64)} x2={x(64)} y1={T - 10} y2={H - 24} stroke="#be123c" strokeWidth={2} />
          <text x={x(64) + 5} y={T - 14} fill="#be123c" fontWeight={500}>result 64</text>
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
          const text = `${l}: ${c} report${c > 1 ? 's' : ''} with ${seatLabel(v)} seats · month median ${med[m]}`
          const show = (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, text })
          return (
            <circle key={`${m}${v}`} cx={x(v)} cy={y(i)} r={Math.max(3, rMax * Math.sqrt(c / max))} fill={v >= 61 ? '#be123c' : '#2a78d6'} fillOpacity={0.75} stroke="#fff" strokeWidth={2}
              onPointerMove={show} onPointerDown={show} onPointerLeave={() => setTip(null)} />
          )
        }))}
      </svg>
      {tip && <div className="fixed z-20 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 font-mono text-xs text-gray-600" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  )
}
