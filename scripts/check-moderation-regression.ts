/**
 * Live regression check for the content-moderation prompt.
 *
 * Run with: npx tsx scripts/check-moderation-regression.ts
 *
 * Sends src/lib/services/__tests__/moderationRegression.cases.ts to the model the app
 * actually moderates with: Vertex Gemini, `stageModel('moderation')` (LLM_STAGE_MODELS,
 * else gemini-2.5-flash), with the same response schema and temperature as
 * checkContent(). The first version sent the prompt to the Oracul /llm (Bedrock), a
 * fallback leg, so it passed 11/11 while Gemini kept blocking the very case the
 * rewrite was for (#1818). Override the model with MODERATION_MODEL to compare.
 *
 * Auth: VERTEX_ACCESS_TOKEN if set, else `gcloud auth print-access-token`. Project:
 * GOOGLE_VERTEX_PROJECT_ID, else `daatan`. Costs live LLM calls, so it is manual.
 * Exits non-zero if any case is not unanimously correct. A run that errors is
 * reported as DEAD and is not scored as correct or incorrect.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 3)

async function main() {
    const { PROMPTS, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { MODERATION_CASES } = await import('../src/lib/services/__tests__/moderationRegression.cases')
    const { moderationSchema } = await import('../src/lib/services/moderation')
    const { stageModel } = await import('../src/lib/llm/stageModels')

    const model = process.env.MODERATION_MODEL || stageModel('moderation', 'gemini-2.5-flash')
    const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
    const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`
    console.log(`model: ${model} (Vertex, project ${project}), ${RUNS} runs per case\n`)

    async function ask(prompt: string): Promise<string> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: moderationSchema },
            }),
        })
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    }

    const template = PROMPTS['content-moderation'].replace(/\{\{appName\}\}/g, 'DAATAN')
    let failures = 0
    for (const c of MODERATION_CASES) {
        const prompt = fillPrompt(template, { contentType: c.contentType, text: c.text })
        const outcomes = await Promise.allSettled(Array.from({ length: RUNS }, () => ask(prompt)))
        const shown: string[] = []
        let correct = 0
        let dead = 0
        for (const o of outcomes) {
            if (o.status === 'rejected') { dead++; shown.push(`ERR ${(o.reason as Error).message.slice(0, 60)}`); continue }
            try {
                const r = JSON.parse(o.value) as { isOffensive?: boolean; reason?: string }
                if (r.isOffensive === c.blocked) correct++
                shown.push(`isOffensive=${r.isOffensive}${r.reason ? ` "${r.reason}"` : ''}`)
            } catch { dead++; shown.push(`ERR unparseable: ${o.value.slice(0, 60)}`) }
        }
        const scored = RUNS - dead
        const pass = scored > 0 && correct === scored
        if (!pass) failures++
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id}\n      want blocked=${c.blocked}  ${correct}/${scored} correct${dead ? ` (${dead} DEAD)` : ''}\n      ${shown.join('\n      ')}`)
    }
    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} case(s) failed`}`)
    process.exit(failures === 0 ? 0 : 1)
}
void main()
