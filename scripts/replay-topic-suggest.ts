/**
 * Replay the topic-suggest prompt (daatan#2308) on a frozen week.
 *
 * Run with: npx tsx scripts/replay-topic-suggest.ts <fixture.json> [out.json]
 *
 * The fixture is `{ groups: [{ sources, reports: PoolReport[] }], forecasts: [{ id, claimText,
 * resolveByDatetime }] }`: the clusters `findTopicSuggestions` would send and the open forecasts
 * they touch. Build it from a read-only export; it holds third-party article text, so keep it
 * out of this public repo. The script renders the prompt with the app's own
 * `buildSuggestPrompt`, sends it to Vertex Gemini the way the `topic_suggest` stage does (same
 * model, schema and temperature, no thinking budget), and checks each answer with
 * `validateSuggestions`. The embedding backstop is not run: compare `coveredBy` and the claims
 * by eye.
 *
 * RUNS (default 3) answers per run; NOW (default 2026-11-24T14:00:00Z) is "today". PROMPT_FILE
 * replays a draft template instead of the one in bedrock-prompts.ts.
 * Auth: VERTEX_ACCESS_TOKEN if set, else `gcloud auth print-access-token`. Project:
 * GOOGLE_VERTEX_PROJECT_ID, else `daatan`. Costs live LLM calls, so it is manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
process.env.LOG_LEVEL ??= 'warn'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const RUNS = Number(process.env.RUNS ?? 3)

async function main() {
  const [fixturePath, outPath] = process.argv.slice(2)
  if (!fixturePath) throw new Error('usage: replay-topic-suggest.ts <fixture.json> [out.json]')
  const { buildSuggestPrompt, renderSuggestPrompt, validateSuggestions } = await import('../src/lib/services/topic-suggestions/suggest')
  const { topicSuggestSchema } = await import('../src/lib/llm/schemas')
  const { stageModel } = await import('../src/lib/llm/stageModels')
  const { STAGES } = await import('../src/lib/llm/registry')

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    groups: Parameters<typeof buildSuggestPrompt>[0]
    forecasts: Array<{ id: string; claimText: string; resolveByDatetime: string }>
  }
  const forecasts = fixture.forecasts.map((f) => ({ ...f, resolveByDatetime: new Date(f.resolveByDatetime) }))
  const now = new Date(process.env.NOW ?? '2026-11-24T14:00:00Z')
  const model = stageModel('topic_suggest')
  const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
  const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`
  const prompt = process.env.PROMPT_FILE
    ? renderSuggestPrompt(readFileSync(process.env.PROMPT_FILE, 'utf8'), fixture.groups, forecasts, now)
    : await buildSuggestPrompt(fixture.groups, forecasts, now)
  console.log(`model: ${model} (Vertex, project ${project}), ${fixture.groups.length} groups, ${forecasts.length} open forecasts, ${RUNS} runs, prompt ${prompt.length} chars\n`)

  async function ask(attempt = 0): Promise<{ raw: Record<string, unknown>; secs: number }> {
    const t = Date.now()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: STAGES.topic_suggest.params.temperature, responseMimeType: 'application/json', responseSchema: topicSuggestSchema },
      }),
    })
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
      return ask(attempt + 1)
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return { raw: JSON.parse((body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')), secs: (Date.now() - t) / 1000 }
  }

  const results = []
  for (let run = 1; run <= RUNS; run++) {
    const { raw, secs } = await ask()
    const out = validateSuggestions(raw, fixture.groups, forecasts, now)
    const reasons = out.skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {})
    console.log(`run ${run}: ${secs.toFixed(0)} s · ${out.stories.length} stories · ${out.suggestions.length} suggestions · skipped ${JSON.stringify(reasons)}`)
    for (const s of out.suggestions) console.log(`  + [${s.story}] ${s.claimText}`)
    for (const s of out.skipped.filter((k) => k.reason === 'covered_by_forecast')) console.log(`  = [${s.story}] covered: ${s.detail?.slice(0, 120)}`)
    for (const s of out.skipped.filter((k) => k.reason !== 'covered_by_forecast')) console.log(`  - [${s.story}] ${s.reason}: ${(s.claim ?? '').slice(0, 120)}`)
    console.log()
    results.push({ run, secs, raw, ...out })
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(results, null, 1))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
