/**
 * Live check for repeat wording ("new", "another", "again") in forecasts (#2094).
 *
 * Run with: npx tsx scripts/check-repeat-wording.ts
 *
 * Two parts, each on the model the app uses for that stage, through Vertex Gemini:
 *
 * - `resolution-research`: a repeat claim with only a pre-creation occurrence must not
 *   resolve `correct`, and one with a post-creation occurrence must. Plain "by <deadline>"
 *   claims are the regression guard (#1511): a pre-creation occurrence still resolves them.
 * - `express-prediction`: rules for a repeat claim state the start date or at least keep the
 *   repeat word, which `resolution-research` reads from the claim anyway. Rules for a plain
 *   claim must not gain a start date.
 *
 * RESEARCH_TEMPLATE_FILE and EXPRESS_TEMPLATE_FILE swap in another text of that prompt, to
 * compare against an older version. RESEARCH_MODEL overrides the verdict model. RUNS sets
 * the run count (default 3). Auth: VERTEX_ACCESS_TOKEN if set, else
 * `gcloud auth print-access-token`. GOOGLE_VERTEX_PROJECT_ID is required and should be prod's
 * project: `gemini-2.5-pro` is not available on every project. Costs live LLM calls, so it is
 * manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RUNS = Number(process.env.RUNS ?? 3)
const CREATED = '2026-08-17'
const DEADLINE = '2026-10-27'
const NOW = new Date('2026-11-02T12:00:00Z')

const BEFORE_ONLY = `Reuters, 2026-02-28: The U.S. and Israel launched aerial attacks in Iran.
Jerusalem Post, 2026-10-21: Since the April 7 ceasefire, no strikes have been reported; the IDF remains on war footing.`
const AFTER_TOO = `Reuters, 2026-02-28: The U.S. and Israel launched aerial attacks in Iran.
Reuters, 2026-09-20: Israeli aircraft struck targets inside Iran overnight, the first strikes since the April 7 ceasefire.`

interface ResearchCase {
    name: string
    claim: string
    rules: string
    context: string
    correct: boolean
}

const RESEARCH_CASES: ResearchCase[] = [
    {
        name: 'Iran 10-28: "new", rules drop the word, only February strike',
        claim: `Israel will carry out a new aerial attack on Iranian territory by October 27, 2026.`,
        rules: `Resolves YES if AP, Reuters or BBC report an Israeli aerial attack on Iranian territory by October 27, 2026.`,
        context: BEFORE_ONLY,
        correct: false,
    },
    {
        name: '"new", a strike after creation',
        claim: `Israel will carry out a new aerial attack on Iranian territory by October 27, 2026.`,
        rules: `Resolves YES if AP, Reuters or BBC report an Israeli aerial attack on Iranian territory by October 27, 2026.`,
        context: AFTER_TOO,
        correct: true,
    },
    {
        name: '"again", only an earlier occurrence',
        claim: `Israel will attack Iran again by October 27, 2026.`,
        rules: `Resolves YES if a major outlet reports an Israeli attack on Iran.`,
        context: BEFORE_ONLY,
        correct: false,
    },
    {
        name: '"another", only an earlier occurrence',
        claim: `The Federal Reserve will announce another interest rate cut by October 27, 2026.`,
        rules: `Resolves YES if the Federal Reserve announces a rate cut by October 27, 2026.`,
        context: `Reuters, 2026-07-29: The Federal Reserve cut rates by 25 basis points.\nReuters, 2026-09-16: The Federal Reserve held rates steady.`,
        correct: false,
    },
    {
        name: '"one more", an occurrence after creation',
        claim: `At least one more drone will fall in one of the Baltic countries by October 27, 2026.`,
        rules: `Resolves YES if a Baltic government confirms a drone crash on its territory by October 27, 2026.`,
        context: `LRT, 2026-07-30: A drone crashed in Lithuania.\nERR, 2026-09-08: Estonia confirmed a drone crash in Ida-Viru county.`,
        correct: true,
    },
    {
        name: 'Hebrew "again", only an earlier occurrence',
        claim: `ישראל תתקוף שוב את איראן עד 27 באוקטובר 2026.`,
        rules: `Resolves YES if a major outlet reports an Israeli attack on Iran.`,
        context: BEFORE_ONLY,
        correct: false,
    },
    {
        name: 'Russian "new", only an earlier occurrence',
        claim: `Израиль нанесёт новый удар по Ирану до 27 октября 2026 года.`,
        rules: `Resolves YES if a major outlet reports an Israeli strike on Iran.`,
        context: BEFORE_ONLY,
        correct: false,
    },
    {
        name: 'guard: plain "by", occurrence before creation',
        claim: `The Federal Reserve will cut interest rates by October 27, 2026.`,
        rules: `Resolves YES if the Federal Reserve announces a rate cut by October 27, 2026.`,
        context: `Reuters, 2026-07-29: The Federal Reserve cut rates by 25 basis points.`,
        correct: true,
    },
    {
        name: 'guard: "New Zealand" is a name, occurrence before creation',
        claim: `New Zealand will hold a general election by October 27, 2026.`,
        rules: `Resolves YES if New Zealand holds a general election by October 27, 2026.`,
        context: `RNZ, 2026-08-08: New Zealand held its general election today.`,
        correct: true,
    },
]

interface ExpressCase {
    input: string
    repeat: boolean
}

const EXPRESS_CASES: ExpressCase[] = [
    { input: `Israel will attack Iran again by the end of the year`, repeat: true },
    { input: `There will be a new lockdown in China by the end of the year`, repeat: true },
    { input: `ישראל תתקוף שוב את איראן עד סוף השנה`, repeat: true },
    { input: `Bitcoin will reach $200k by the end of the year`, repeat: false },
    { input: `Gold will reach $6000 an ounce by the end of the year`, repeat: false },
    { input: `Tesla stock will hit $1000 by the end of the year`, repeat: false },
    { input: `New Zealand will win the Rugby Championship next year`, repeat: false },
    { input: `The Fed will cut rates by the end of the year`, repeat: false },
    { input: `Russia and Ukraine will sign a ceasefire by the end of the year`, repeat: false },
]

const STATES_START = /2026-11-02|November 2, 2026/
const REPEAT_WORD = /\b(new|another|again|one more|further|additional|second)\b/i

async function main() {
    const { PROMPTS, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { researchSchema } = await import('../src/lib/llm/schemas')
    const { expressPredictionSchema } = await import('../src/lib/llm/expressPrediction')
    const { stageModel } = await import('../src/lib/llm/stageModels')
    const { deadlineStatus } = await import('../src/lib/services/resolutionResearch')

    const project = process.env.GOOGLE_VERTEX_PROJECT_ID
    if (!project) throw new Error('Set GOOGLE_VERTEX_PROJECT_ID')
    const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

    async function call(model: string, text: string, schema: unknown, temperature: number, attempt = 0): Promise<Record<string, unknown>> {
        const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text }] }],
                generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
            }),
        })
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
            return call(model, text, schema, temperature, attempt + 1)
        }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        return JSON.parse((body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''))
    }

    let failed = 0

    const researchFile = process.env.RESEARCH_TEMPLATE_FILE
    const expressFile = process.env.EXPRESS_TEMPLATE_FILE
    const researchTemplate = researchFile ? readFileSync(researchFile, 'utf8') : PROMPTS['resolution-research']
    const researchModel = process.env.RESEARCH_MODEL || stageModel('research_verdict', 'gemini-2.5-pro')
    if (!expressFile) console.log(`resolution-research: ${researchModel}${researchFile ? `, template ${researchFile}` : ''}, ${RUNS} runs per case\n`)
    const researchRuns = expressFile ? [] : await Promise.all(RESEARCH_CASES.map((c) => Promise.all(Array.from({ length: RUNS }, () => call(researchModel, fillPrompt(researchTemplate, {
        claimText: c.claim,
        outcomeType: 'BINARY',
        optionsContext: '',
        resolutionRules: c.rules,
        forecastStartStr: CREATED,
        forecastEndStr: DEADLINE,
        currentDate: NOW.toISOString().split('T')[0],
        deadlineStatus: deadlineStatus(new Date(`${DEADLINE}T23:59:59Z`), NOW),
        context: `News Context:\n${c.context}`,
    }), researchSchema, 0)))))
    if (!expressFile) RESEARCH_CASES.forEach((c, i) => {
        const outcomes = researchRuns[i].map((r) => String(r.outcome))
        const ok = outcomes.every((o) => (o === 'correct') === c.correct)
        if (!ok) failed += 1
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${outcomes.join(', ')} (want ${c.correct ? 'correct' : 'not correct'})`)
    })

    if (!researchFile) {
        const expressModel = stageModel('express_draft', 'gemini-2.5-flash')
        const today = '2026-11-02'
        const expressTemplate = expressFile ? readFileSync(expressFile, 'utf8') : PROMPTS['express-prediction']
        console.log(`\nexpress-prediction: ${expressModel}${expressFile ? `, template ${expressFile}` : ''}, ${RUNS} runs per case\n`)
        const expressRuns = await Promise.all(EXPRESS_CASES.map((c) => Promise.all(Array.from({ length: RUNS }, () => call(expressModel, fillPrompt(expressTemplate, {
            userInput: c.input,
            articlesText: '(none)',
            endOfYear: '2026-12-31T23:59:59.000Z',
            endOfYearHuman: 'December 31, 2026',
            fiveYearsFromNow: '2031-11-02T23:59:59.000Z',
            fiveYearsFromNowHuman: 'November 2, 2031',
            currentYear: '2026',
            currentDate: today,
            STANDARD_TAGS: 'Geopolitics, Economy',
        }), expressPredictionSchema, 0.2)))))
        EXPRESS_CASES.forEach((c, i) => {
            const rules = expressRuns[i].map((r) => String(r.resolutionRules))
            const started = rules.filter((r) => STATES_START.test(r)).length
            const worded = rules.filter((r) => STATES_START.test(r) || REPEAT_WORD.test(r)).length
            const ok = c.repeat ? worded === rules.length : started === 0
            if (!ok) failed += 1
            console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.input}" (${c.repeat ? 'repeat' : 'plain'}): start date in ${started}/${rules.length}, date or repeat word in ${worded}/${rules.length}`)
            const shown = rules.find((r) => STATES_START.test(r) !== c.repeat) ?? rules[0]
            console.log(`      rules: ${shown}`)
        })
    }

    console.log(failed ? `\n${failed} case(s) failed` : '\nall cases passed')
    process.exit(failed ? 1 : 0)
}

main().catch((err) => {
    console.error(err)
    process.exit(2)
})
