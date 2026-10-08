/**
 * Live polarity check for the express-draft prompt (#1807).
 *
 * Run with: npx tsx scripts/check-express-polarity.ts
 *
 * Drafts each input in src/lib/llm/__tests__/expressPolarity.cases.ts with the
 * express-prediction prompt, on the model the app drafts with: Vertex Gemini,
 * `stageModel('express_draft')` (LLM_STAGE_MODELS, else gemini-2.5-flash), with the
 * same response schema and temperature as expressPrediction.ts. A judge call
 * (temperature 0) then compares the author's input with the draft claim on two
 * separate axes, so a reversed claim that also moved its deadline still counts:
 *   direction   same | opposite  — opposite fails the run (negation lost or added)
 *   proposition same | different — different is reported, not failed (the judge
 *                                  also says it for a changed default deadline)
 * A 2026-10-08 run drafted "A ceasefire agreement will be reached in Gaza…" from
 * "there will be no ceasefire in Gaza by the end of the year" in 2 runs out of 8.
 *
 * The prompt gets no articles ("No relevant articles found."), so this checks the
 * rule, not retrieval. Override the model with EXPRESS_MODEL, the judge with
 * JUDGE_MODEL, the run count with RUNS (default 10).
 *
 * Auth: VERTEX_ACCESS_TOKEN if set, else `gcloud auth print-access-token`. Project:
 * GOOGLE_VERTEX_PROJECT_ID, else `daatan`. Costs live LLM calls, so it is manual.
 * Exits non-zero if any run's direction is judged `opposite`. A run that errors is reported as
 * DEAD and is not scored.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'

const RUNS = Number(process.env.RUNS ?? 10)

const judgeSchema = {
    type: 'OBJECT',
    properties: {
        direction: { type: 'STRING', enum: ['same', 'opposite'] },
        proposition: { type: 'STRING', enum: ['same', 'different'] },
        note: { type: 'STRING' },
    },
    required: ['direction', 'proposition', 'note'],
}

function judgePrompt(input: string, claim: string, today: string): string {
    return [
        'You check whether a forecast drafted from an author\'s words keeps the author\'s direction.',
        `Today is ${today}; "the end of the year" in the author's words means the end of this year.`,
        'Compare the AUTHOR INPUT (any language) with the DRAFT CLAIM (English) and answer two separate questions.',
        'direction: "opposite" if the claim is true when the author would be wrong — a negation lost or added.',
        'Otherwise "same", even when other details differ.',
        'proposition: "different" if, direction aside, the subject, condition, threshold or deadline changed',
        'materially. Adding a default deadline the author left open, or a resolution source, is not a change.',
        'note: one short sentence.',
        '',
        `AUTHOR INPUT: ${input}`,
        `DRAFT CLAIM: ${claim}`,
    ].join('\n')
}

async function main() {
    const { getPromptTemplate, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { POLARITY_CASES } = await import('../src/lib/llm/__tests__/expressPolarity.cases')
    const { expressPredictionSchema } = await import('../src/lib/llm/expressPrediction')
    const { stageModel } = await import('../src/lib/llm/stageModels')

    const model = process.env.EXPRESS_MODEL || stageModel('express_draft', 'gemini-2.5-flash')
    const judgeModel = process.env.JUDGE_MODEL || 'gemini-2.5-flash'
    const project = process.env.GOOGLE_VERTEX_PROJECT_ID || 'daatan'
    const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const endpoint = (m: string) => `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${m}:generateContent`
    console.log(`draft: ${model}, judge: ${judgeModel} (Vertex, project ${project}), ${RUNS} runs per case\n`)

    async function ask(m: string, prompt: string, temperature: number, responseSchema: unknown, attempt = 0): Promise<string> {
        const res = await fetch(endpoint(m), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature, responseMimeType: 'application/json', responseSchema },
            }),
        })
        if (res.status === 429 && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
            return ask(m, prompt, temperature, responseSchema, attempt + 1)
        }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    }

    const now = new Date()
    const year = now.getFullYear()
    const in5 = new Date(now)
    in5.setFullYear(year + 5)
    const human = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    const template = await getPromptTemplate('express-prediction')

    async function draftAndJudge(input: string): Promise<{ claim: string; direction: string; proposition: string; note: string }> {
        const prompt = fillPrompt(template, {
            userInput: input,
            articlesText: 'No relevant articles found.',
            endOfYear: `${year}-12-31T23:59:59Z`,
            endOfYearHuman: `December 31, ${year}`,
            fiveYearsFromNow: `${in5.toISOString().split('T')[0]}T23:59:59Z`,
            fiveYearsFromNowHuman: human(in5),
            currentYear: year,
            currentDate: now.toISOString().split('T')[0],
            STANDARD_TAGS: 'Politics, Economy, Technology, Sports, Culture, World',
        })
        const claim = (JSON.parse(await ask(model, prompt, 0.2, expressPredictionSchema)) as { claimText: string }).claimText
        const j = JSON.parse(await ask(judgeModel, judgePrompt(input, claim, now.toISOString().split('T')[0]), 0, judgeSchema)) as { direction: string; proposition: string; note: string }
        return { claim, ...j }
    }

    let flips = 0
    let drifts = 0
    let dead = 0
    for (const c of POLARITY_CASES) {
        const outcomes = await Promise.allSettled(Array.from({ length: RUNS }, () => draftAndJudge(c.input)))
        const shown: string[] = []
        const tally = { same: 0, opposite: 0, different: 0, dead: 0 }
        for (const o of outcomes) {
            if (o.status === 'rejected') { tally.dead++; shown.push(`DEAD ${(o.reason as Error).message.slice(0, 80)}`); continue }
            const { direction, proposition, claim, note } = o.value
            if (direction === 'opposite') tally.opposite++
            else if (proposition === 'different') tally.different++
            else tally.same++
            if (direction === 'opposite' || proposition === 'different') {
                shown.push(`${direction === 'opposite' ? 'OPPOSITE' : 'DIFFERENT'}  ${claim}\n          (${note})`)
            }
        }
        flips += tally.opposite
        drifts += tally.different
        dead += tally.dead
        const status = tally.opposite ? 'FAIL' : tally.different ? 'WARN' : 'PASS'
        console.log(`${status}  ${c.id}${c.negated ? ' (negated)' : ''}  same=${tally.same} opposite=${tally.opposite} different=${tally.different}${tally.dead ? ` dead=${tally.dead}` : ''}`)
        for (const s of shown) console.log(`      ${s}`)
    }
    console.log(`\n${flips} flipped, ${drifts} different, ${dead} dead, of ${POLARITY_CASES.length * RUNS} runs`)
    console.log(flips === 0 ? 'NO POLARITY FLIPS' : 'POLARITY FLIPS FOUND')
    process.exit(flips === 0 ? 0 : 1)
}
void main()
