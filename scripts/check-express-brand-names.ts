/**
 * Live check for daatan#2134: does the express draft keep an unfamiliar brand/person name
 * exactly as the author wrote it, or "correct" it into a similar known word
 * (prod 2026-11-09: "Hungru" → "Hungarian cuisine")?
 *
 * Run with: npx tsx scripts/check-express-brand-names.ts
 *
 * Each case is drafted with the real express-prediction prompt + schema (temperature 0.2,
 * as expressPrediction.ts) in two modes:
 *   source-free — articlesText is the user input only, as the skipSources path sends it
 *   lookalike   — articles about the similar known word (what a web search for an unknown
 *                 brand tends to return: "Hungru" → Hungarian food stories)
 * A run passes when claimText contains every `keep` name verbatim (case-insensitive) and
 * none of the `avoid` words. RUNS per case/mode (default 3), MODEL (default gemini-2.5-flash).
 * Auth as bench-express-draft.ts (VERTEX_ACCESS_TOKEN or gcloud). Costs live LLM calls.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 3)
const MODEL = process.env.MODEL ?? 'gemini-2.5-flash'

interface Case { id: string; input: string; keep: string[]; avoid: string[]; lookalike: string }
const CASES: Case[] = [
  { id: 'hungru', input: 'Hungru will dominate the global culinary market by November 9, 2028', keep: ['Hungru'], avoid: ['Hungarian', 'Hungary'], lookalike: 'Hungarian cuisine' },
  { id: 'hungru-spotify', input: 'Hungru, the Spotify for food, will become the leading food discovery app worldwide by 2028', keep: ['Hungru'], avoid: ['Hungarian', 'Hungary'], lookalike: 'Hungarian cuisine' },
  { id: 'hungru-he', input: 'Hungru תשלוט בשוק הקולינריה העולמי עד 2028', keep: ['Hungru'], avoid: ['Hungarian', 'Hungary'], lookalike: 'Hungarian cuisine' },
  { id: 'zentrix', input: 'Zentrix will IPO on NASDAQ by the end of 2027', keep: ['Zentrix'], avoid: ['Zentric', 'Centrix'], lookalike: 'Centrix' },
  { id: 'nuvelio', input: 'Nuvelio will reach one million paying users by June 2027', keep: ['Nuvelio'], avoid: ['Novelio', 'Nuvola'], lookalike: 'Nuvola' },
  { id: 'person', input: 'Shani Rahamim will raise a Series A for her startup by the end of 2027', keep: ['Shani Rahamim'], avoid: ['Rachamim', 'Rahamin'], lookalike: 'Shani Rachamim' },
  { id: 'ctl-known', input: 'Spotify will launch a food delivery service by 2028', keep: ['Spotify'], avoid: [], lookalike: 'Spotify' },
]

function lookalikeArticles(c: Case): string {
  return Array.from({ length: 4 }, (_, i) => `
[${i + 1}] Title: ${c.lookalike} is having a moment, analysts say
Source: Example News ${i + 1}
Published: 2026-10-2${i}
Snippet: Interest in ${c.lookalike} keeps growing this year. Industry observers say ${c.lookalike} could reshape its market, though competition remains intense.
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
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: expressPredictionSchema, thinkingConfig: { thinkingBudget: 512 } },
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

  const now = new Date()
  const year = now.getFullYear()
  const template = await getPromptTemplate('express-prediction')
  const totals: Record<string, { ok: number; n: number }> = {}
  for (const mode of ['source-free', 'lookalike'] as const) {
    for (const c of CASES) {
      const prompt = fillPrompt(template, {
        userInput: c.input,
        articlesText: mode === 'source-free' ? `[User Input]\n${c.input}` : lookalikeArticles(c),
        endOfYear: `${year}-12-31T23:59:59Z`, endOfYearHuman: `December 31, ${year}`,
        fiveYearsFromNow: `${year + 5}-11-09T23:59:59Z`, fiveYearsFromNowHuman: `November 9, ${year + 5}`,
        currentYear: year, currentDate: now.toISOString().split('T')[0],
        STANDARD_TAGS: 'Politics, Economy, Technology, Sports, Culture, World, Food, Business',
      })
      const runs = await Promise.allSettled(Array.from({ length: RUNS }, () => ask(prompt)))
      for (const r of runs) {
        const key = `${mode}${c.id.startsWith('ctl') ? ' (control)' : ''}`
        totals[key] ??= { ok: 0, n: 0 }
        totals[key].n++
        if (r.status === 'rejected') { console.log(`DEAD ${mode} ${c.id} ${r.reason}`); continue }
        const claim = (JSON.parse(r.value) as { claimText: string }).claimText
        const lc = claim.toLowerCase()
        const ok = c.keep.every((k) => lc.includes(k.toLowerCase())) && !c.avoid.some((a) => lc.includes(a.toLowerCase()))
        if (ok) totals[key].ok++
        console.log(`${ok ? 'ok  ' : 'MISS'} ${mode} ${c.id} | ${claim}`)
      }
    }
  }
  console.log('')
  for (const [k, v] of Object.entries(totals)) console.log(`${k}: ${v.ok}/${v.n} kept the name`)
}

main().catch((e) => { console.error(e); process.exit(1) })
