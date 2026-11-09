/**
 * Live check for daatan#2122 item 2: does the express draft put resolveByDatetime on a
 * trigger event's own day (election day) when the claim's outcome is only known later
 * (PM appointed/sworn in, government formed, official turnout statistics)?
 *
 * Run with: npx tsx scripts/check-express-event-deadline.ts
 *
 * Drafts each case with the real express-prediction prompt + schema (temperature 0.2,
 * as expressPrediction.ts) on a pinned "today" before the event, with synthetic articles
 * that state the event date. Reports resolveBy days after the event per run:
 *   lagged cases   — must land AFTER the event day (> 0)
 *   control cases  — the event itself decides them; must stay ON the event day (0)
 * RUNS per case (default 3), MODEL (default gemini-2.5-flash). Auth as
 * bench-express-draft.ts (VERTEX_ACCESS_TOKEN or gcloud). Costs live LLM calls.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 3)
const MODEL = process.env.MODEL ?? 'gemini-2.5-flash'
const TODAY = '2026-08-20'
const EVENT = '2026-10-27'

interface Case { id: string; input: string; lagged: boolean; event: string; context: string }
const ELECTION = `Israel's general election for the 26th Knesset is scheduled for October 27, ${EVENT.slice(0, 4)}.`
const CASES: Case[] = [
  { id: 'pm-eisenkot', lagged: true, event: EVENT, context: ELECTION, input: 'Gadi Eisenkot will be Prime Minister after the October 27 elections, maybe in a rotation' },
  { id: 'pm-bennett-he', lagged: true, event: EVENT, context: ELECTION, input: 'בנט יושבע לראש הממשלה הבא' },
  { id: 'gov-mixed', lagged: true, event: EVENT, context: ELECTION, input: 'The first government sworn in after the next Knesset elections will include at least one current opposition party and one current coalition party' },
  { id: 'turnout-haredi', lagged: true, event: EVENT, context: ELECTION, input: 'Haredi turnout will be higher than non-Haredi Jewish turnout in the October 27 elections (per CBS / official statistics)' },
  { id: 'ctl-likud-seats', lagged: false, event: EVENT, context: ELECTION, input: 'Likud will win the most seats in the October 27 Knesset elections' },
  { id: 'ctl-earnings', lagged: false, event: '2026-10-29', context: 'Apple will report its fiscal Q4 2026 results on October 29, 2026.', input: 'Apple will report iPhone revenue above $50 billion in its October 29 earnings report' },
]

function articles(c: Case): string {
  return Array.from({ length: 4 }, (_, i) => `
[${i + 1}] Title: Outlook ahead of the vote: ${c.input}
Source: Example News ${i + 1}
Published: 2026-08-1${i + 1}
Snippet: ${c.context} Analysts offered differing views this week. Observers noted that the situation remains fluid.
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
  const template = await getPromptTemplate('express-prediction')
  let laggedOk = 0, laggedN = 0, ctlOk = 0, ctlN = 0
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
      const d = JSON.parse(r.value) as { claimText: string; resolveByDatetime: string; dateBasis?: string }
      const lag = Math.round((Date.parse(d.resolveByDatetime.slice(0, 10)) - Date.parse(c.event)) / 86_400_000)
      const ok = c.lagged ? lag > 0 : lag === 0
      if (c.lagged) { laggedN++; if (ok) laggedOk++ } else { ctlN++; if (ok) ctlOk++ }
      console.log(`${ok ? 'ok  ' : 'MISS'} ${c.id} | +${lag}d | ${d.resolveByDatetime.slice(0, 10)} | ${d.dateBasis} | ${d.claimText}`)
    }
  }
  console.log(`\nlagged after event: ${laggedOk}/${laggedN} · controls on event day: ${ctlOk}/${ctlN}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
