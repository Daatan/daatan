/**
 * Eval for a searching express draft (daatan#2290). Runs the real draft path —
 * `makeExpressDraft` + `draftWithGroundedDate` on the real `llmService` chain, with the
 * committed prompt, schema, registry entry and model quirks — over the polarity cases and a
 * set of hard date cases, with the arms interleaved so each sees the same network and quota.
 *
 * Run with:
 *   GOOGLE_VERTEX_PROJECT_ID=<project> OUT=<rows.jsonl> npx tsx scripts/eval-express-grounded.ts
 *
 * Auth: your gcloud user token (or VERTEX_ACCESS_TOKEN). The app's Vertex leg signs a
 * service-account JWT and exchanges it for a token; here a throwaway key signs it and the
 * exchange is answered with your token, so the provider code runs unchanged. The chain is
 * the Vertex leg only, so a failed draft counts as a failure instead of being rescued by
 * another vendor. Costs live Vertex calls (a full run is ~350 drafts plus judge calls).
 *
 * Arms (ARMS, comma list; default all three; named ship / rollback / nosearch in the
 * daatan#2290 runs):
 *   search    the candidate: SEARCH_MODEL (default gemini-3.5-flash-lite) with Google Search
 *             and no thinking cap, one call; no lookup after a draft that searched.
 *   current   the registry as committed (gemini-2.5-flash, thinking cap 512, no search): the
 *             speculative grounded-date lookup + re-draft run as in prod.
 *   nosearch  SEARCH_MODEL without the tool, as a Google leg without search drafts it; the
 *             lookup runs after an "assumed" draft, as it does for a fallback draft.
 * Articles are 8 synthetic snippets without dates, so a date has to come from search, the
 * lookup or the input.
 *
 * Gate to switch (daatan#2290): 0 confirmed polarity flips (hand-read the `opposite` rows;
 * the judge over-flags), 0 non-English claims, dates in range >= current with no more
 * confidently wrong ones (outside the range, basis not "assumed"), lower p90. A thinking cap
 * made Flash-Lite skip search (daatan#2290 run 1), so the search arm sends none.
 * RUNS_DATE (default 5), RUNS_POL (default 3), WORKERS (default 6), CASES (comma list of case ids;
 * default all).
 */
process.env.SKIP_ENV_VALIDATION = '1'
process.env.LOG_LEVEL ??= 'silent'
import { execSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const PROJECT = process.env.GOOGLE_VERTEX_PROJECT_ID
if (!PROJECT) throw new Error('set GOOGLE_VERTEX_PROJECT_ID (the Vertex project to bill)')
const OUT = process.env.OUT
const RUNS_DATE = Number(process.env.RUNS_DATE ?? 5)
const RUNS_POL = Number(process.env.RUNS_POL ?? 3)
const WORKERS = Number(process.env.WORKERS ?? 6)
const ARMS = (process.env.ARMS ?? 'search,current,nosearch').split(',') as Arm[]
type Arm = 'search' | 'current' | 'nosearch'
const SEARCH_MODEL = process.env.SEARCH_MODEL ?? 'gemini-3.5-flash-lite'
const CASES = process.env.CASES ? new Set(process.env.CASES.split(',')) : null
const picked = (c: { id: string }) => !CASES || CASES.has(c.id)

// The chain must be the Vertex leg alone; drop every other provider before the app loads.
for (const k of [
  'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_BASE_URL', 'ORACLE_URL', 'ORACLE_API_KEY',
  'LLM_STAGE_MODELS', 'TELEGRAM_BOT_TOKEN',
]) delete process.env[k]
process.env.GOOGLE_VERTEX_CLIENT_EMAIL = 'eval-express-grounded@local.invalid'
process.env.GOOGLE_VERTEX_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey
process.env.GOOGLE_VERTEX_LOCATION = 'global'

const TOKEN = process.env.VERTEX_ACCESS_TOKEN
  || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3000 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return realFetch(input, init)
}) as typeof fetch

/**
 * Accept ranges, fixed before the run (2026-11-23). Israeli government formation: Eisenkot got
 * the mandate ~2026-11-08; 28 + 14 days -> ~12-20, a second MK's 28 days -> ~01-20, then 21
 * days -> ~02-10-2027, then elections ~90 days later (~May). The legal deadline is ~Feb, and
 * for "another election before a government forms" the election date is defensible too. The
 * two 2028 cases check that a searched date is not flagged as an ungrounded year.
 */
const DATE_CASES: { id: string; input: string; range: [string, string] }[] = [
  { id: 'he_gov_arab', input: 'מפלגה ערבית תהיה חלק מהממשלה הבאה', range: ['2027-01-15', '2027-03-31'] },
  { id: 'he_netanyahu_not', input: 'נתניהו לא יהיה חלק מהממשלה הבאה', range: ['2027-01-15', '2027-03-31'] },
  { id: 'he_new_election', input: 'יהיו בחירות נוספות לפני שתקום ממשלה', range: ['2027-01-15', '2027-06-15'] },
  { id: 'celtics', input: 'Celtics will finish with the best record in the 2026-27 NBA regular season', range: ['2027-04-05', '2027-04-20'] },
  { id: 'rust_tiobe', input: 'Rust will be back in the TIOBE top 10', range: ['2026-12-31', '2027-12-31'] },
  { id: 'cl_final', input: 'Real Madrid will win the 2027 Champions League', range: ['2027-06-05', '2027-06-06'] },
  { id: 'fed_next', input: 'The Fed will cut rates at its next meeting', range: ['2026-12-08', '2026-12-10'] },
  { id: 'hungru', input: 'Hungru will become a leading social culinary app by 2028', range: ['2027-12-31', '2028-12-31'] },
  { id: 'ukraine_neg', input: 'There will be no ceasefire in Ukraine by the end of 2027', range: ['2027-12-31', '2027-12-31'] },
  { id: 'us_pres', input: 'A Democrat will win the next US presidential election', range: ['2028-11-07', '2029-01-20'] },
  { id: 'olympics', input: 'The USA will top the medal table at the next Summer Olympics', range: ['2028-07-30', '2028-08-15'] },
]

function articles(input: string): string {
  return Array.from({ length: 8 }, (_, i) => `
[Article ${i + 1}]
Title: Analysts weigh the outlook on: ${input}
Source: Example News ${i + 1}
Published: Unknown
Snippet: Officials and analysts offered differing views this week on the question of ${input}. Several said the key decisions are expected in the coming months, while others cautioned that timelines have slipped before and that no formal announcement has been made. Markets reacted cautiously to the reports, and observers noted that the situation remains fluid.
URL: https://example.com/news/${i + 1}
`).join('\n')
}

const judgeSchema = {
  type: 'OBJECT',
  properties: { direction: { type: 'STRING', enum: ['same', 'opposite'] }, proposition: { type: 'STRING', enum: ['same', 'different'] } },
  required: ['direction', 'proposition'],
}

/** The polarity judge (as check-express-polarity.ts), on gemini-2.5-flash, outside the app chain. */
async function judge(input: string, claim: string, today: string, attempt = 0): Promise<{ direction: string; proposition: string }> {
  const res = await realFetch(
    `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/gemini-2.5-flash:generateContent`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: [
          'Compare the AUTHOR INPUT (any language) with the DRAFT CLAIM (English).', `Today is ${today}.`,
          'direction: "opposite" if the claim is true when the author would be wrong (negation lost or added), else "same".',
          'proposition: "different" if, direction aside, subject/condition/threshold/deadline changed materially; adding a default deadline the author left open is not a change.',
          `AUTHOR INPUT: ${input}`, `DRAFT CLAIM: ${claim}`,
        ].join('\n') }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: judgeSchema },
      }),
    },
  )
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    return judge(input, claim, today, attempt + 1)
  }
  if (!res.ok) throw new Error(`judge ${res.status} ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return JSON.parse(body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '{}')
}

const NON_ENGLISH = /[Ѐ-ӿ֐-׿]/

async function main() {
  const { llmService } = await import('../src/lib/llm')
  const { getPromptTemplate } = await import('../src/lib/llm/bedrock-prompts')
  const ep = await import('../src/lib/llm/expressPrediction')
  const { POLARITY_CASES } = await import('../src/lib/llm/__tests__/expressPolarity.cases')
  if (llmService.legCount !== 1) throw new Error(`expected the Vertex leg alone, got ${llmService.legCount} legs`)
  const template = await getPromptTemplate('express-prediction')
  type Service = import('../src/lib/llm/expressPrediction').ExpressDraftService
  type Request = Parameters<Service['generateContent']>[0]

  /** The arm's view of the chain. A 429 is quota noise: retried, and its wait not counted. */
  function armService(arm: Arm, waited: { ms: number }): Service {
    const armRequest = (r: Request): Request => {
      if (arm === 'current') return r
      const { thinkingBudget: _cap, ...rest } = r
      return { ...rest, model: SEARCH_MODEL, googleSearch: arm === 'search' }
    }
    const call = async (r: Request, attempt = 0): ReturnType<Service['generateContent']> => {
      const t0 = Date.now()
      try {
        return await llmService.generateContent(armRequest(r))
      } catch (e) {
        if (!/Vertex 429/.test(String(e)) || attempt >= 5) throw e
        const backoff = 2000 * 2 ** attempt
        await new Promise((res) => setTimeout(res, backoff))
        waited.ms += Date.now() - t0
        return call(r, attempt + 1)
      }
    }
    return {
      generateContent: (r) => call(r),
      // nosearch stands for a draft that fell back from a primary that would have searched.
      primarySearches: (r) => (arm === 'nosearch' ? true : llmService.primarySearches(armRequest(r))),
    }
  }

  type Job = { arm: Arm; kind: 'date' | 'pol'; id: string; input: string; run: number; range?: [string, string] }
  const jobs: Job[] = []
  for (const arm of ARMS) {
    for (const c of DATE_CASES.filter(picked)) for (let r = 0; r < RUNS_DATE; r++) jobs.push({ arm, kind: 'date', id: c.id, input: c.input, run: r, range: c.range })
    for (const c of POLARITY_CASES.filter(picked)) for (let r = 0; r < RUNS_POL; r++) jobs.push({ arm, kind: 'pol', id: c.id, input: c.input, run: r })
  }
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[jobs[i], jobs[j]] = [jobs[j], jobs[i]]
  }
  console.error(`${jobs.length} jobs${OUT ? ` -> ${OUT}` : ''}`)

  type Row = Record<string, unknown> & { arm: Arm; kind: string; id: string; ok: boolean }
  const rows: Row[] = []
  let next = 0
  let done = 0
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      let row: Row
      try {
        const now = new Date()
        const waited = { ms: 0 }
        const { draft, primarySearches } = ep.makeExpressDraft(job.input, template, now, armService(job.arm, waited))
        const t0 = Date.now()
        const r = await ep.draftWithGroundedDate(job.input, articles(job.input), now, draft, undefined, {}, primarySearches)
        const ms = Date.now() - t0 - waited.ms
        const p = r.prediction
        const basis = ep.normalizeDateBasis(p.dateBasis)
        const path = r.groundedDate.fired ? r.groundedDate.status : r.draftSearch ? 'one-call' : 'no-lookup'
        const j = await judge(job.input, p.claimText, now.toISOString().slice(0, 10))
        const date = p.resolveByDatetime?.slice(0, 10) ?? ''
        const inRange = job.range ? date >= job.range[0] && date <= job.range[1] : null
        row = {
          arm: job.arm, kind: job.kind, id: job.id, run: job.run, ok: true, ms, path,
          searches: r.draftSearch?.queries ?? null, date, dateBasis: basis, inRange,
          lookup: r.groundedDate.fired && r.groundedDate.status === 'found' ? { date: r.groundedDate.date, event: r.groundedDate.event } : null,
          confidentWrong: job.range ? !inRange && basis !== 'assumed' : null,
          ungroundedYears: ep.findUngroundedYears(p.claimText, p.resolveByDatetime, `${job.input}\n${r.articlesText}`, now, {
            datesFromSearch: ep.datesFromSearch(p, r.draftSearch),
          }),
          nonEnglish: NON_ENGLISH.test(p.claimText),
          nonEnglishAny: NON_ENGLISH.test(`${p.claimText}\n${p.detailsText}\n${p.resolutionRules}`),
          direction: j.direction, proposition: j.proposition,
          nameKept: job.id === 'hungru' ? /hungru/i.test(p.claimText) : null, claim: p.claimText,
        }
      } catch (e) {
        row = { arm: job.arm, kind: job.kind, id: job.id, run: job.run, ok: false, error: String(e).slice(0, 300) }
      }
      rows.push(row)
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n')
      if (++done % 50 === 0) console.error(`${done}/${jobs.length}`)
    }
  }))

  const pct = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0
  }
  const lat = (xs: number[]) => (xs.length ? `${(pct(xs, 0.5) / 1000).toFixed(1)}/${(pct(xs, 0.9) / 1000).toFixed(1)}/${(Math.max(...xs) / 1000).toFixed(1)}` : '-')
  console.log('arm | n | fail | opposite | non-English claim | non-English any field | different | dates in range | confidently wrong | assumed left | ungrounded-year flags | hungru name lost | p50/p90/max s | date cases | polarity cases')
  for (const arm of ARMS) {
    const a = rows.filter((r) => r.arm === arm)
    const ok = a.filter((r) => r.ok)
    const dc = ok.filter((r) => r.kind === 'date')
    const ms = (xs: Row[]) => xs.map((r) => r.ms as number)
    console.log([
      arm, a.length, a.length - ok.length,
      ok.filter((r) => r.direction === 'opposite').length,
      ok.filter((r) => r.nonEnglish).length,
      ok.filter((r) => r.nonEnglishAny).length,
      ok.filter((r) => r.proposition === 'different').length,
      `${dc.filter((r) => r.inRange).length}/${dc.length}`,
      dc.filter((r) => r.confidentWrong).length,
      dc.filter((r) => r.dateBasis === 'assumed').length,
      ok.filter((r) => (r.ungroundedYears as string[]).length > 0).length,
      ok.filter((r) => r.nameKept === false).length,
      lat(ms(ok)), lat(ms(dc)), lat(ms(ok.filter((r) => r.kind === 'pol'))),
    ].join(' | '))
  }
  console.log('\nlatency by path (p50/p90/max s, n) · search queries per one-call draft (mean, share with 0)')
  for (const arm of ARMS) {
    const ok = rows.filter((r) => r.arm === arm && r.ok)
    const paths = [...new Set(ok.map((r) => r.path as string))]
    const q = ok.filter((r) => r.searches !== null).map((r) => r.searches as number)
    console.log(`${arm}: ` + paths.map((p) => {
      const xs = ok.filter((r) => r.path === p).map((r) => r.ms as number)
      return `${p} ${lat(xs)} n=${xs.length}`
    }).join(' · ') + (q.length ? ` · queries mean ${(q.reduce((s, x) => s + x, 0) / q.length).toFixed(1)}, 0 in ${q.filter((x) => x === 0).length}/${q.length}` : ''))
  }
  console.log('\ndate cases: in range per arm (of runs)')
  console.log('case | range | ' + ARMS.join(' | '))
  for (const c of DATE_CASES.filter(picked)) {
    console.log(`${c.id} | ${c.range.join('..')} | ` + ARMS.map((arm) => {
      const xs = rows.filter((r) => r.arm === arm && r.id === c.id && r.ok)
      return `${xs.filter((r) => r.inRange).length}/${xs.length}`
    }).join(' | '))
  }
  console.log('\nto hand-read (opposite / non-English / confidently wrong / ungrounded year / failures):')
  for (const r of rows) {
    if (!r.ok) console.log(`  FAIL ${r.arm} ${r.id}: ${r.error}`)
    else if (r.direction === 'opposite' || r.nonEnglishAny || r.confidentWrong || (r.ungroundedYears as string[]).length) {
      const tags = [
        r.direction === 'opposite' && 'OPPOSITE', r.nonEnglish ? 'NON-EN' : r.nonEnglishAny && 'NON-EN-FIELD',
        r.confidentWrong && 'CONF-WRONG', (r.ungroundedYears as string[]).length && `UNGROUNDED ${(r.ungroundedYears as string[]).join(',')}`,
      ].filter(Boolean).join(' ')
      console.log(`  ${tags} ${r.arm} ${r.id} ${r.date} ${r.dateBasis} ${r.path} | ${r.claim}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
