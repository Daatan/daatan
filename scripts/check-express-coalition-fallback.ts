/**
 * Live check for daatan#2166 (express-prediction rule 9c): in a coalition-system election,
 * resolution rules must not carry a fallback that always applies there ("if no single party
 * forms a government", "if no party wins a majority").
 *
 * Run with: npx tsx scripts/check-express-coalition-fallback.ts
 *
 * Drafts each case with the express-prediction prompt + schema (temperature 0.2, as
 * expressPrediction.ts) and checks the rules:
 *   coalition cases — the rules must not contain an always-true fallback (regex below)
 *   controls        — a non-coalition election and an explicit "most seats" claim; reported
 *                     so a reviewer can see the rule did not distort them
 * Every draft's rules are printed, so the verdict can be read by eye as well as by regex.
 *
 * TEMPLATE_FILE swaps in another text of the prompt (e.g. the previous version) to compare.
 * RUNS per case (default 3), MODEL (default gemini-2.5-flash). Auth: VERTEX_ACCESS_TOKEN if
 * set, else `gcloud auth print-access-token`. GOOGLE_VERTEX_PROJECT_ID defaults to `daatan`;
 * use prod's project for a like-for-like run. Costs live LLM calls, so it is manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RUNS = Number(process.env.RUNS ?? 3)
const MODEL = process.env.MODEL ?? 'gemini-2.5-flash'
const TODAY = '2026-08-20'

/** A fallback whose condition always holds where governments are coalitions. */
const ALWAYS_TRUE_FALLBACK =
  /no single party (?:forms?|is able to form|can form|wins|secures)|if no (?:party|single party) (?:wins|secures|obtains|gains) (?:a|an outright|an absolute) majority|single[- ]party government/i

interface Case { id: string; input: string; coalition: boolean; context: string }
const KNESSET = `Israel's general election for the 26th Knesset is scheduled for October 27, 2026. Polls show Likud as the largest party, with no bloc certain to reach 61 seats.`
const DUTCH = `The Netherlands will hold a snap general election for the House of Representatives on March 17, 2027. Polls put D66, GL-PvdA and the PVV close together.`
const CASES: Case[] = [
  { id: 'likud-win', coalition: true, context: KNESSET, input: 'Likud will win the next general election in Israel' },
  { id: 'likud-win-he', coalition: true, context: KNESSET, input: 'הליכוד ינצח בבחירות הבאות' },
  { id: 'eisenkot-win-ru', coalition: true, context: KNESSET, input: 'Партия Айзенкота победит на выборах в Кнессет' },
  { id: 'likud-govern', coalition: true, context: KNESSET, input: 'Likud will form the next government after the elections' },
  { id: 'd66-win', coalition: true, context: DUTCH, input: 'D66 will win the Dutch election' },
  { id: 'ctl-likud-seats', coalition: false, context: KNESSET, input: 'Likud will win the most seats in the October 27 Knesset elections' },
  { id: 'ctl-us-house', coalition: false, context: 'The US midterm elections are on November 3, 2026.', input: 'Democrats will win a majority in the US House in the midterms' },
]

function articles(c: Case): string {
  return Array.from({ length: 4 }, (_, i) => `
[${i + 1}] Title: Ahead of the vote: ${c.input}
Source: Example News ${i + 1}
Published: 2026-08-1${i + 1}
Snippet: ${c.context} Analysts offered differing views this week.
URL: https://example.com/news/${i + 1}
`).join('\n')
}

async function main() {
  const { getPromptTemplate, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
  const { expressPredictionSchema } = await import('../src/lib/llm/expressPrediction')
  const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
  const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`

  async function ask(prompt: string, attempt = 0): Promise<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: expressPredictionSchema },
      }),
    })
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      return ask(prompt, attempt + 1)
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  }

  const year = Number(TODAY.slice(0, 4))
  const file = process.env.TEMPLATE_FILE
  const template = file
    ? readFileSync(file, 'utf8').replaceAll('{{appName}}', 'DAATAN')
    : await getPromptTemplate('express-prediction')
  let coalOk = 0, coalN = 0, ctlN = 0
  for (const c of CASES) {
    const prompt = fillPrompt(template, {
      userInput: c.input, articlesText: articles(c),
      endOfYear: `${year}-12-31T23:59:59Z`, endOfYearHuman: `December 31, ${year}`,
      fiveYearsFromNow: `${year + 5}${TODAY.slice(4)}T23:59:59Z`, fiveYearsFromNowHuman: `${TODAY.slice(5)}, ${year + 5}`,
      currentYear: year, currentDate: TODAY,
      STANDARD_TAGS: 'Politics, Economy, Technology, Sports, Culture, World',
    })
    const runs = await Promise.allSettled(Array.from({ length: RUNS }, () => ask(prompt)))
    for (const r of runs) {
      if (r.status === 'rejected') { console.log(`${c.id} | DEAD ${r.reason}`); continue }
      const d = JSON.parse(r.value) as { claimText: string; resolutionRules: string; resolveByDatetime: string }
      const bad = ALWAYS_TRUE_FALLBACK.test(d.resolutionRules)
      if (c.coalition) { coalN++; if (!bad) coalOk++ } else ctlN++
      const tag = c.coalition ? (bad ? 'MISS' : 'ok  ') : 'ctl '
      console.log(`${tag} ${c.id} | ${d.resolveByDatetime.slice(0, 10)} | ${d.claimText}\n       rules: ${d.resolutionRules.replace(/\s+/g, ' ')}\n`)
    }
  }
  console.log(`coalition cases without an always-true fallback: ${coalOk}/${coalN} · controls drafted: ${ctlN}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
