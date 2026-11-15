/**
 * Live check for daatan#2166: the claim-definedness judge, end to end from the author's input.
 *
 * Run with: npx tsx scripts/check-claim-definedness.ts
 *
 * Each case is drafted with the express-prediction prompt + schema (temperature 0.2, as
 * expressPrediction.ts), then the drafted claim and rules go to the claim-definedness judge
 * (temperature 0, gated by definednessBlocks, as claimDefinedness.ts). `flag` inputs leave a
 * deciding term open ("win" an election where the largest party may not lead the
 * government): the draft must either name the criterion in the claim or be blocked, and
 * never publish a bare "win". `pass` controls must not be blocked. Every blocked verdict is
 * printed with its split outcome and options, so it can be read by eye.
 *
 * JUDGE_ONLY_FILE=<jsonl> skips drafting and judges rows {id, claimText, resolutionRules}
 * instead (the read-only false-positive sweep over prod; keep such files out of the repo).
 * VERDICTS_OUT=<jsonl> appends each verdict there.
 * TEMPLATE_FILE swaps in another text of the express prompt. RUNS per case (default 3),
 * MODEL (default gemini-2.5-flash). Auth: VERTEX_ACCESS_TOKEN if set, else
 * `gcloud auth print-access-token`. GOOGLE_VERTEX_PROJECT_ID defaults to `daatan`; use
 * prod's project for a like-for-like run. Costs live LLM calls, so it is manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const RUNS = Number(process.env.RUNS ?? 3)
const MODEL = process.env.MODEL ?? 'gemini-2.5-flash'
const TODAY = '2026-08-20'

interface Case { id: string; input: string; expect: 'flag' | 'pass'; context: string }
const KNESSET = `Israel's general election for the 26th Knesset is scheduled for October 27, 2026. Polls show Likud as the largest party, with no bloc certain to reach 61 seats.`
const DUTCH = `The Netherlands will hold a snap general election for the House of Representatives on March 17, 2027. Polls put D66, GL-PvdA and the PVV close together.`
const CASES: Case[] = [
  { id: 'likud-win', expect: 'flag', context: KNESSET, input: 'Likud will win the next general election in Israel' },
  { id: 'likud-win-he', expect: 'flag', context: KNESSET, input: 'הליכוד ינצח בבחירות הבאות' },
  { id: 'eisenkot-win-ru', expect: 'flag', context: KNESSET, input: 'Партия Айзенкота победит на выборах в Кнессет' },
  { id: 'd66-win', expect: 'flag', context: DUTCH, input: 'D66 will win the Dutch election' },
  { id: 'likud-seats', expect: 'pass', context: KNESSET, input: 'Likud will win the most seats in the October 27 Knesset elections' },
  { id: 'netanyahu-pm', expect: 'pass', context: KNESSET, input: 'Netanyahu will be sworn in as Prime Minister after the October 2026 elections' },
  { id: 'us-house', expect: 'pass', context: 'The US midterm elections are on November 3, 2026.', input: 'Democrats will win a majority in the US House in the midterms' },
  { id: 'btc-200k', expect: 'pass', context: 'Bitcoin trades near $120,000 after a volatile summer.', input: 'Bitcoin will reach $200,000 before the end of 2026' },
  { id: 'ucl-final', expect: 'pass', context: 'The 2027 UEFA Champions League final will be played in Madrid on May 29, 2027.', input: 'Real Madrid will win the 2027 Champions League' },
  { id: 'fed-cut', expect: 'pass', context: 'The Federal Reserve meets on December 15-16, 2026; markets price a cut.', input: 'The Fed will cut interest rates at its December 2026 meeting' },
]

function articles(c: Case): string {
  return Array.from({ length: 4 }, (_, i) => `
[${i + 1}] Title: Ahead of the decision: ${c.input}
Source: Example News ${i + 1}
Published: 2026-08-1${i + 1}
Snippet: ${c.context} Analysts offered differing views this week.
URL: https://example.com/news/${i + 1}
`).join('\n')
}

interface Verdict { splitOutcome: string; splitChance: number; readerShare: number; fault: string; term: string; question: string; options: string[]; blocked: boolean }
/** A coalition-election claim that names its criterion is well-defined without asking. */
const NAMES_CRITERION = /most seats|largest (?:party|faction)|form(?:s)? the (?:next )?government|sworn in|prime minister|majority/i

async function main() {
  const { getPromptTemplate, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
  const { expressPredictionSchema } = await import('../src/lib/llm/expressPrediction')
  const { claimDefinednessSchema } = await import('../src/lib/llm/schemas')
  const { definednessBlocks } = await import('../src/lib/llm/claimDefinedness')
  const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
  const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`

  async function ask(prompt: string, schema: object, temperature: number, attempt = 0): Promise<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
      }),
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      return ask(prompt, schema, temperature, attempt + 1)
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  }

  const judgeTemplate = await getPromptTemplate('claim-definedness')
  let shownRaw = false
  async function judge(claimText: string, resolutionRules: string, language = 'English'): Promise<Verdict> {
    const raw = await ask(fillPrompt(judgeTemplate, { claimText, resolutionRules, language }), claimDefinednessSchema, 0)
    if (!shownRaw) { shownRaw = true; console.log(`raw key order: ${raw.slice(0, 160).replace(/\s+/g, ' ')}\n`) }
    const v = JSON.parse(raw) as Omit<Verdict, 'blocked'>
    // Same gate as claimDefinedness.ts.
    return { ...v, blocked: definednessBlocks(v) }
  }
  const show = (v: Verdict) => v.blocked
    ? `\n       [${v.fault} chance=${v.splitChance} share=${v.readerShare}] term: ${v.term} | q: ${v.question}\n       split: ${v.splitOutcome}\n       options: ${v.options.join(' || ')}`
    : ''

  const judgeOnly = process.env.JUDGE_ONLY_FILE
  if (judgeOnly) {
    const rows = readFileSync(judgeOnly, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; claimText: string; resolutionRules: string })
    let flagged = 0, done = 0
    for (let i = 0; i < rows.length; i += 8) {
      const batch = rows.slice(i, i + 8)
      const out = await Promise.allSettled(batch.map((r) => judge(r.claimText, r.resolutionRules)))
      out.forEach((o, k) => {
        const r = batch[k]
        if (o.status === 'rejected') { console.log(`DEAD ${r.id} ${o.reason}`); return }
        done++
        if (process.env.VERDICTS_OUT) appendFileSync(process.env.VERDICTS_OUT, JSON.stringify({ id: r.id, ...o.value }) + '\n')
        if (o.value.blocked) flagged++
        console.log(`${o.value.blocked ? 'FLAG' : 'ok  '} ${r.id} | ${r.claimText}${show(o.value)}\n`)
      })
    }
    console.log(`flagged ${flagged}/${done}`)
    return
  }

  const year = Number(TODAY.slice(0, 4))
  const file = process.env.TEMPLATE_FILE
  const template = file
    ? readFileSync(file, 'utf8').replaceAll('{{appName}}', 'DAATAN')
    : await getPromptTemplate('express-prediction')
  const tally = { flag: { named: 0, blocked: 0, bad: 0 }, pass: { ok: 0, blocked: 0 } }
  for (const c of CASES) {
    const prompt = fillPrompt(template, {
      userInput: c.input, articlesText: articles(c),
      endOfYear: `${year}-12-31T23:59:59Z`, endOfYearHuman: `December 31, ${year}`,
      fiveYearsFromNow: `${year + 5}${TODAY.slice(4)}T23:59:59Z`, fiveYearsFromNowHuman: `${TODAY.slice(5)}, ${year + 5}`,
      currentYear: year, currentDate: TODAY,
      STANDARD_TAGS: 'Politics, Economy, Technology, Sports, Culture, World',
    })
    const runs = await Promise.allSettled(Array.from({ length: RUNS }, async () => {
      const d = JSON.parse(await ask(prompt, expressPredictionSchema, 0.2)) as { claimText: string; resolutionRules: string; resolveByDatetime: string }
      return { d, v: await judge(d.claimText, d.resolutionRules) }
    }))
    for (const r of runs) {
      if (r.status === 'rejected') { console.log(`${c.id} | DEAD ${r.reason}`); continue }
      const { d, v } = r.value
      let tag: string
      if (c.expect === 'flag') {
        // Never a publishable draft whose claim still says a bare "win": the claim names
        // the criterion, or the judge blocks it.
        const named = NAMES_CRITERION.test(d.claimText)
        tag = v.blocked ? 'BLCK' : named ? 'NAMD' : 'MISS'
        if (v.blocked) tally.flag.blocked++; else if (named) tally.flag.named++; else tally.flag.bad++
      } else {
        tag = v.blocked ? 'MISS' : 'ok  '
        if (v.blocked) tally.pass.blocked++; else tally.pass.ok++
      }
      console.log(`${tag} ${c.id} (${c.expect}) | ${d.resolveByDatetime.slice(0, 10)} | ${d.claimText}\n       rules: ${d.resolutionRules.replace(/\s+/g, ' ')}${show(v)}\n`)
    }
  }
  console.log(`ambiguous-input cases: ${tally.flag.named} named in claim, ${tally.flag.blocked} blocked, ${tally.flag.bad} bare "win" published · controls: ${tally.pass.ok} passed, ${tally.pass.blocked} blocked`)
}

main().catch((e) => { console.error(e); process.exit(1) })
