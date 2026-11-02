/**
 * Latency + quality bench for the express-draft stage (#1890, option B).
 *
 * Run with: npx tsx scripts/bench-express-draft.ts
 *
 * Drafts each POLARITY_CASES input with the real express-prediction prompt and schema
 * (temperature 0.2, as expressPrediction.ts) under several generation variants, with a
 * synthetic block of 8 articles so the prompt is prod-sized. Reports wall-clock latency,
 * thinking tokens, and the same polarity judge as check-express-polarity.ts:
 *   opposite  — the draft reversed the author's direction (a hard failure)
 *   different — subject/threshold/deadline drifted (reported)
 *   non-English — the claim kept Hebrew/Cyrillic script (claims must be English)
 *
 * VARIANTS: comma list of `model[:thinkingBudget]`, default
 *   gemini-2.5-flash,gemini-2.5-flash:0,gemini-2.5-flash-lite
 * (no budget = the model's default dynamic thinking, which is what prod sends today).
 * RUNS per case (default 2). Auth as check-express-polarity.ts. Costs live LLM calls.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 2)
const VARIANTS = (process.env.VARIANTS ?? 'gemini-2.5-flash,gemini-2.5-flash:0,gemini-2.5-flash-lite')
  .split(',').map((v) => {
    const [model, budget] = v.split(':')
    return { label: v, model, thinkingBudget: budget === undefined ? undefined : Number(budget) }
  })

const judgeSchema = {
  type: 'OBJECT',
  properties: {
    direction: { type: 'STRING', enum: ['same', 'opposite'] },
    proposition: { type: 'STRING', enum: ['same', 'different'] },
  },
  required: ['direction', 'proposition'],
}

function articles(input: string): string {
  return Array.from({ length: 8 }, (_, i) => `
[${i + 1}] Title: Analysts weigh the outlook on: ${input}
Source: Example News ${i + 1}
Published: 2026-10-${String(20 + (i % 9)).padStart(2, '0')}
Snippet: Officials and analysts offered differing views this week on the question of ${input}. Several said the key decisions are expected in the coming months, while others cautioned that timelines have slipped before and that no formal announcement has been made. Markets reacted cautiously to the reports, and observers noted that the situation remains fluid.
URL: https://example.com/news/${i + 1}
`).join('\n')
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0
}

async function main() {
  const { getPromptTemplate, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
  const { POLARITY_CASES } = await import('../src/lib/llm/__tests__/expressPolarity.cases')
  const { expressPredictionSchema } = await import('../src/lib/llm/expressPrediction')
  const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
  const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const endpoint = (m: string) => `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${m}:generateContent`

  type Usage = { thoughtsTokenCount?: number; candidatesTokenCount?: number; promptTokenCount?: number }
  async function ask(m: string, prompt: string, temperature: number, responseSchema: unknown, thinkingBudget?: number, attempt = 0): Promise<{ text: string; ms: number; usage: Usage }> {
    const t0 = Date.now()
    const res = await fetch(endpoint(m), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature, responseMimeType: 'application/json', responseSchema,
          ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
        },
      }),
    })
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      return ask(m, prompt, temperature, responseSchema, thinkingBudget, attempt + 1)
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: Usage }
    return { text: (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''), ms: Date.now() - t0, usage: body.usageMetadata ?? {} }
  }

  const now = new Date()
  const year = now.getFullYear()
  const in5 = new Date(now); in5.setFullYear(year + 5)
  const human = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const template = await getPromptTemplate('express-prediction')
  const today = now.toISOString().split('T')[0]

  console.log(`${POLARITY_CASES.length} cases x ${RUNS} runs per variant, 8 synthetic articles\n`)
  console.log('variant | n | p50 ms | p90 ms | max ms | avg thinking tok | avg out tok | opposite | different | non-English | dead')
  for (const v of VARIANTS) {
    const ms: number[] = []; const thoughts: number[] = []; const outs: number[] = []
    let opposite = 0, different = 0, dead = 0, nonEnglish = 0
    for (const c of POLARITY_CASES) {
      const prompt = fillPrompt(template, {
        userInput: c.input, articlesText: articles(c.input),
        endOfYear: `${year}-12-31T23:59:59Z`, endOfYearHuman: `December 31, ${year}`,
        fiveYearsFromNow: `${in5.toISOString().split('T')[0]}T23:59:59Z`, fiveYearsFromNowHuman: human(in5),
        currentYear: year, currentDate: today,
        STANDARD_TAGS: 'Politics, Economy, Technology, Sports, Culture, World',
      })
      const runs = await Promise.allSettled(Array.from({ length: RUNS }, async () => {
        const d = await ask(v.model, prompt, 0.2, expressPredictionSchema, v.thinkingBudget)
        const claim = (JSON.parse(d.text) as { claimText: string }).claimText
        const j = JSON.parse((await ask('gemini-2.5-flash', [
          'Compare the AUTHOR INPUT (any language) with the DRAFT CLAIM (English).',
          `Today is ${today}.`,
          'direction: "opposite" if the claim is true when the author would be wrong (negation lost or added), else "same".',
          'proposition: "different" if, direction aside, subject/condition/threshold/deadline changed materially; adding a default deadline the author left open is not a change.',
          `AUTHOR INPUT: ${c.input}`, `DRAFT CLAIM: ${claim}`,
        ].join('\n'), 0, judgeSchema)).text) as { direction: string; proposition: string }
        return { d, j, claim }
      }))
      for (const r of runs) {
        if (r.status === 'rejected') { dead++; continue }
        ms.push(r.value.d.ms); thoughts.push(r.value.d.usage.thoughtsTokenCount ?? 0); outs.push(r.value.d.usage.candidatesTokenCount ?? 0)
        if (/[\u0400-\u04FF\u0590-\u05FF]/.test(r.value.claim)) { nonEnglish++; console.error(`  [${v.label}] NON-ENGLISH ${c.id}: ${r.value.claim}`) }
        if (r.value.j.direction === 'opposite') { opposite++; console.error(`  [${v.label}] OPPOSITE ${c.id}: ${r.value.claim}`) }
        else if (r.value.j.proposition === 'different') { different++; console.error(`  [${v.label}] different ${c.id}: ${r.value.claim}`) }
      }
    }
    const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / (xs.length || 1))
    console.log(`${v.label} | ${ms.length} | ${pct(ms, 0.5)} | ${pct(ms, 0.9)} | ${Math.max(0, ...ms)} | ${avg(thoughts)} | ${avg(outs)} | ${opposite} | ${different} | ${nonEnglish} | ${dead}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
