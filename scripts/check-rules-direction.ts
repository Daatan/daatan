/**
 * Live check for the rules-direction prompt (#1813).
 *
 * Run with: npx tsx scripts/check-rules-direction.ts
 *
 * Sends each case in src/lib/llm/__tests__/rulesDirection.cases.ts (taken from the
 * #1802 audit of live forecasts) to the model ensureRulesDirection() uses: Vertex
 * Gemini, `stageModel('rules_direction')` (LLM_STAGE_MODELS, else gemini-2.5-flash),
 * with the same schema and temperature. For an `inverted` verdict it re-checks the
 * returned `fixedRules`, as the app does, and prints them.
 *
 * A case passes when every run's verdict matches `expected`, and every inverted case
 * gets a rewrite that the re-check calls consistent. An `unclear` case passes on any
 * verdict but inverted: unclear and consistent both leave the rules untouched. The
 * consistent negated claims are the regression guard: a prompt that "fixes" correct
 * rules is worse than none.
 *
 * Override the model with RULES_MODEL and the run count with RUNS (default 3).
 * Auth: VERTEX_ACCESS_TOKEN if set, else `gcloud auth print-access-token`. Project:
 * GOOGLE_VERTEX_PROJECT_ID, else `daatan`. Costs live LLM calls, so it is manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 3)

async function main() {
    const { getPromptTemplate, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { RULES_DIRECTION_CASES } = await import('../src/lib/llm/__tests__/rulesDirection.cases')
    const { rulesDirectionSchema } = await import('../src/lib/llm/schemas')
    const { stageModel } = await import('../src/lib/llm/stageModels')

    const model = process.env.RULES_MODEL || stageModel('rules_direction', 'gemini-2.5-flash')
    const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
    const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`
    console.log(`model: ${model} (Vertex, project ${project}), ${RUNS} runs per case\n`)

    const template = await getPromptTemplate('rules-direction')

    async function judge(claimText: string, resolutionRules: string, attempt = 0): Promise<{ direction: string; fixedRules: string; yesCondition: string }> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: fillPrompt(template, { claimText, resolutionRules }) }] }],
                generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: rulesDirectionSchema },
            }),
        })
        if (res.status === 429 && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
            return judge(claimText, resolutionRules, attempt + 1)
        }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        return JSON.parse((body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''))
    }

    async function run(claim: string, rules: string): Promise<{ verdict: string; fixed?: string; recheck?: string }> {
        const first = await judge(claim, rules)
        if (first.direction !== 'inverted') return { verdict: first.direction }
        if (!first.fixedRules?.trim()) return { verdict: 'inverted', recheck: 'no rewrite' }
        const second = await judge(claim, first.fixedRules)
        return { verdict: 'inverted', fixed: first.fixedRules, recheck: second.direction }
    }

    let failures = 0
    for (const c of RULES_DIRECTION_CASES) {
        const outcomes = await Promise.allSettled(Array.from({ length: RUNS }, () => run(c.claim, c.rules)))
        const lines: string[] = []
        let ok = 0
        let dead = 0
        for (const o of outcomes) {
            if (o.status === 'rejected') { dead++; lines.push(`DEAD ${(o.reason as Error).message.slice(0, 80)}`); continue }
            const { verdict, fixed, recheck } = o.value
            // unclear and consistent both leave the rules alone, so an unclear case only fails on inverted.
            const good = c.expected === 'unclear'
                ? verdict !== 'inverted'
                : verdict === c.expected && (verdict !== 'inverted' || recheck === 'consistent')
            if (good) ok++
            if (!good || fixed) lines.push(`${verdict}${recheck ? ` → re-check ${recheck}` : ''}${fixed ? `\n          fixed: ${fixed}` : ''}`)
        }
        const scored = RUNS - dead
        const pass = scored > 0 && ok === scored
        if (!pass) failures++
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id}  want ${c.expected}  ${ok}/${scored}${dead ? ` (${dead} DEAD)` : ''}`)
        if (!pass) console.log(`      claim: ${c.claim}`)
        // One rewrite per inverted case is enough to read; the rest are near-identical.
        for (const l of pass ? lines.slice(0, 1) : lines) console.log(`      ${l}`)
    }
    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} case(s) failed`}`)
    process.exit(failures === 0 ? 0 : 1)
}
void main()
