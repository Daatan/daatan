/**
 * Live check that AI Assist (`resolution-research`) does not resolve a multi-condition claim
 * `correct` when one condition is unproven or failed (daatan#2180).
 *
 * Run with: npx tsx scripts/check-conjunction-resolution.ts
 *
 * The Texas case replays what AI Assist saw on 2026-11-15, from
 * `scripts/fixtures/resolution-conjunction-texas.json`: the claim needed the Senate seat AND a
 * majority of Texas's 38 House seats; the House went 24 R / 14 D, so the truth is NO. The
 * news context is the 5 sources that verdict cited (og:description as the snippet; the live
 * snippets were not captured). The controls are synthetic Georgia cases on a future date, so
 * the model's own knowledge cannot decide them: all conditions met, one failed, a single
 * condition, a pre-deadline partial result, and "blue wave" coverage with no seat count.
 *
 * Each verdict passes through `guardVerdict`, as in the app. A case passes when every run's
 * final outcome is in its `want` list. The output also shows the raw outcome and the
 * per-condition statuses.
 *
 * A second part checks `research-query-generation` on the stage's model: for each two-condition
 * claim, every run must return a separate query for each condition: one that names the House
 * and not the Senate, and one the other way round. QUERY_TEMPLATE_FILE swaps in another text of that prompt; QUERIES=0 skips this part.
 *
 * To reproduce the pre-#2180 behaviour (the baseline):
 *   RESEARCH_TEMPLATE_FILE=<v3 text> POOL=legacy SCHEMA=legacy GUARD=0 npx tsx scripts/check-conjunction-resolution.ts
 * POOL=legacy selects and formats the pool as before (settled, then evidence weight; no claim
 * line). SCHEMA=legacy drops `conditions`. GUARD=0 skips `guardVerdict`. RESEARCH_MODEL, RUNS
 * (default 3), CASE (substring filter) and DUMP=1 (print the Texas prompt) are optional. Auth
 * and project as in `scripts/check-repeat-wording.ts`: GOOGLE_VERTEX_PROJECT_ID (prod's), and
 * VERTEX_ACCESS_TOKEN or `gcloud auth print-access-token`. Costs live LLM calls, so it is manual.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RUNS = Number(process.env.RUNS ?? 3)
const POOL = process.env.POOL === 'legacy' ? 'legacy' : 'new'
const SCHEMA = process.env.SCHEMA === 'legacy' ? 'legacy' : 'new'
const GUARD = process.env.GUARD !== '0'

interface FixtureRow {
    url: string
    title: string | null
    source: string | null
    publishedDate: string | null
    stance: number | null
    settled: boolean | null
    settlementEventDate: string | null
    evidenceClass: string | null
    addedAt: string
    evidenceWeight: number | null
    claims: { claim: string; stance: number; settled: boolean }[]
}
interface NewsItem { title: string; source: string; publishedDate?: string; snippet: string; url: string }
interface Fixture {
    claimText: string
    resolutionRules: string
    created: string
    deadline: string
    now: string
    poolRows: FixtureRow[]
    news: NewsItem[]
}

interface Case {
    name: string
    claim: string
    rules: string
    created: string
    deadline: string
    now: string
    pool: FixtureRow[]
    news: NewsItem[]
    want: string[]
}

const GA_RULES = `This claim resolves YES if, following the 2026 midterm elections, the Democratic Party wins the US Senate seat contested in Georgia and a majority of Georgia's 14 US House seats. Official results from the Georgia Secretary of State or a consensus of major news outlets (e.g., AP, Reuters) will be used for resolution.`
const GA_CLAIM = `Democrats will win both the Georgia US Senate seat and a majority of Georgia's US House seats in the 2026 midterm elections.`
const GA_DATES = { created: '2026-09-01', deadline: '2026-11-30', now: '2026-11-15T12:00:00Z' }
const OSSOFF_WON: NewsItem = {
    title: 'Ossoff wins second term in Georgia Senate race',
    source: 'apnews.com',
    publishedDate: '2026-11-04',
    snippet: 'Democratic Sen. Jon Ossoff won re-election in Georgia on Tuesday, AP projected, defeating his Republican challenger by about 4 points.',
    url: 'https://apnews.com/article/georgia-senate-ossoff-2026',
}
const news = (title: string, snippet: string, url: string, publishedDate = '2026-11-06'): NewsItem =>
    ({ title, source: url.split('/')[2], publishedDate, snippet, url })

function controls(): Case[] {
    return [
        {
            name: 'control: both conditions met',
            claim: GA_CLAIM, rules: GA_RULES, ...GA_DATES, pool: [],
            news: [OSSOFF_WON, news(
                'Democrats flip three seats, win 8 of Georgia\'s 14 House seats',
                'With every race now called, Democrats will hold 8 of Georgia\'s 14 US House seats next year, up from 5, AP tallies show.',
                'https://www.ajc.com/politics/georgia-house-results-2026',
            )],
            want: ['correct'],
        },
        {
            name: 'control: Senate met, House failed',
            claim: GA_CLAIM, rules: GA_RULES, ...GA_DATES, pool: [],
            news: [OSSOFF_WON, news(
                'Republicans keep 9 of Georgia\'s 14 House seats despite Ossoff win',
                'Every Georgia House race has been called: Republicans won 9 of the state\'s 14 seats and Democrats 5, unchanged from 2024.',
                'https://www.ajc.com/politics/georgia-house-results-2026',
            )],
            want: ['wrong'],
        },
        {
            name: 'control: single condition met',
            claim: `Jon Ossoff will win re-election to the US Senate from Georgia in the 2026 midterm elections.`,
            rules: `This claim resolves YES if Jon Ossoff wins the 2026 Georgia US Senate election, per official results or a consensus of major news outlets.`,
            ...GA_DATES, pool: [], news: [OSSOFF_WON],
            want: ['correct'],
        },
        {
            name: 'control: Senate met, House still counting, before deadline',
            claim: GA_CLAIM, rules: GA_RULES, ...GA_DATES, now: '2026-11-05T12:00:00Z', pool: [],
            news: [OSSOFF_WON, news(
                'Georgia House: 3 races still too close to call',
                'Democrats have won 6 of Georgia\'s 14 House seats and Republicans 5; three districts remain too close to call as provisional ballots are counted.',
                'https://www.ajc.com/politics/georgia-house-uncalled-2026', '2026-11-05',
            )],
            want: ['unresolvable'],
        },
        {
            name: 'control: Senate met, House only "blue wave" coverage',
            claim: GA_CLAIM, rules: GA_RULES, ...GA_DATES, pool: [],
            news: [OSSOFF_WON, news(
                'Blue tsunami sweeps the South as Democrats rout Republicans',
                'Democrats rode a blue wave across Georgia, holding the Senate seat and flipping the governor\'s mansion in a night that stunned Republicans.',
                'https://www.politico.com/news/2026/11/06/blue-wave-south',
            )],
            want: ['unresolvable', 'wrong'],
        },
    ]
}

function legacyPoolContext(rows: FixtureRow[]): string {
    if (rows.length === 0) return ''
    return `Curated evidence pool (${rows.length} highest-weight articles extracted for this exact claim; stance is in [-1, 1], +1 = supports the claim):\n`
        + rows.map((r) =>
            `- ${r.publishedDate ?? 'undated'} | ${r.source ?? 'unknown source'} | "${r.title ?? r.url}" | stance ${r.stance}`
            + (r.evidenceClass ? ` | ${r.evidenceClass}` : '')
            + (r.settled ? ` | SETTLEMENT ASSERTED${r.settlementEventDate ? ` on ${r.settlementEventDate}` : ''}` : '')
            + ` | ${r.url}`,
        ).join('\n')
}

/** Mirrors `getPoolArticlesForResearch`: settled first, then evidence weight (legacy) or recency (new). */
function selectPool(rows: FixtureRow[], limit = 12): FixtureRow[] {
    const second = POOL === 'legacy'
        ? (a: FixtureRow, b: FixtureRow) => (b.evidenceWeight ?? -1) - (a.evidenceWeight ?? -1)
        : (a: FixtureRow, b: FixtureRow) => b.addedAt.localeCompare(a.addedAt)
    return [...rows]
        .sort((a, b) => Number(b.settled === true) - Number(a.settled === true) || second(a, b))
        .slice(0, limit)
}

async function main() {
    const { PROMPTS, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { researchSchema, queryGenerationSchema } = await import('../src/lib/llm/schemas')
    const { stageModel } = await import('../src/lib/llm/stageModels')
    const { deadlineStatus, formatPoolContext, guardVerdict } = await import('../src/lib/services/resolutionResearch')

    const project = process.env.GOOGLE_VERTEX_PROJECT_ID
    if (!project) throw new Error('Set GOOGLE_VERTEX_PROJECT_ID')
    const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

    async function call(model: string, text: string, schema: unknown, temperature = 0, attempt = 0): Promise<Record<string, unknown>> {
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

    const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'resolution-conjunction-texas.json'), 'utf8')) as Fixture
    const cases: Case[] = [
        {
            name: 'Texas 2026: Senate won, House 24 R / 14 D',
            claim: fx.claimText, rules: fx.resolutionRules, created: fx.created, deadline: fx.deadline, now: fx.now,
            pool: fx.poolRows, news: fx.news,
            want: ['wrong', 'unresolvable'],
        },
        ...controls(),
    ].filter((c) => !process.env.CASE || c.name.includes(process.env.CASE))

    const templateFile = process.env.RESEARCH_TEMPLATE_FILE
    const template = templateFile ? readFileSync(templateFile, 'utf8') : PROMPTS['resolution-research']
    const full = researchSchema as { properties: Record<string, unknown>; required?: string[] }
    const schema = SCHEMA === 'legacy'
        ? (() => {
            const { conditions: _dropped, ...properties } = full.properties
            return { ...full, properties, required: (full.required ?? []).filter((k) => k !== 'conditions') }
        })()
        : full
    const model = process.env.RESEARCH_MODEL || stageModel('research_verdict', 'gemini-2.5-pro')
    console.log(`resolution-research: ${model}, template ${templateFile ?? 'current'}, pool ${POOL}, schema ${SCHEMA}, guard ${GUARD ? 'on' : 'off'}, ${RUNS} runs per case\n`)

    const prompts = cases.map((c) => {
        const pool = selectPool(c.pool).map((r) => ({ ...r, claimsDetail: r.claims }))
        const poolContext = POOL === 'legacy' ? legacyPoolContext(pool) : formatPoolContext(pool)
        const newsContext = c.news.length > 0
            ? `News Context (${c.news.length} articles found for the forecast period):\n` + c.news.map((r) =>
                `Title: ${r.title}\nSource: ${r.source}${r.publishedDate ? ` (${r.publishedDate})` : ''}\nSnippet: ${r.snippet}\nURL: ${r.url}`,
            ).join('\n\n')
            : ''
        const now = new Date(c.now)
        return fillPrompt(template, {
            claimText: c.claim,
            outcomeType: 'BINARY',
            optionsContext: '',
            resolutionRules: c.rules,
            forecastStartStr: c.created,
            forecastEndStr: c.deadline,
            currentDate: now.toISOString().split('T')[0],
            deadlineStatus: deadlineStatus(new Date(`${c.deadline}T23:59:59Z`), now),
            context: [poolContext, newsContext].filter(Boolean).join('\n\n'),
        })
    })
    if (process.env.DUMP === '1') console.log(`${prompts[0]}\n\n----\n`)

    const runs = await Promise.all(prompts.map((p) => Promise.all(Array.from({ length: RUNS }, () => call(model, p, schema)))))

    let failed = 0
    cases.forEach((c, i) => {
        const rows = runs[i].map((raw) => {
            const conditions = Array.isArray(raw.conditions) ? raw.conditions as { condition: string; status: 'met' | 'failed' | 'unconfirmed'; evidence?: string }[] : undefined
            const outcome = String(raw.outcome) as 'correct' | 'wrong' | 'void' | 'unresolvable'
            const premature = raw.premature === true
            const base = { outcome: premature ? 'unresolvable' as const : outcome, conditions }
            const final = GUARD ? guardVerdict(base, 'BINARY').outcome : base.outcome
            return { raw: outcome, final, premature, conditions, reasoning: String(raw.reasoning ?? '') }
        })
        const ok = rows.every((r) => c.want.includes(r.final))
        if (!ok) failed += 1
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${rows.map((r) => r.raw === r.final ? r.final : `${r.raw}→${r.final}`).join(', ')} (want ${c.want.join('/')})`)
        rows.forEach((r, k) => {
            if (r.conditions) console.log(`      run ${k + 1}: ${r.conditions.map((x) => `[${x.status}] ${x.condition.slice(0, 70)}`).join(' · ')}`)
        })
        const shown = rows.find((r) => !c.want.includes(r.final)) ?? rows[0]
        console.log(`      reasoning: ${shown.reasoning.replace(/\s+/g, ' ').slice(0, Number(process.env.REASONING_CHARS ?? 400))}`)
    })

    if (process.env.QUERIES !== '0') {
        const queryFile = process.env.QUERY_TEMPLATE_FILE
        const queryTemplate = queryFile ? readFileSync(queryFile, 'utf8') : PROMPTS['research-query-generation']
        const queryModel = stageModel('research_queries', 'gemini-2.5-flash')
        const queryCases = [
            { name: 'Texas', claim: fx.claimText, rules: fx.resolutionRules, created: fx.created, deadline: fx.deadline },
            { name: 'Georgia', claim: GA_CLAIM, rules: GA_RULES, ...GA_DATES },
        ]
        console.log(`\nresearch-query-generation: ${queryModel}, template ${queryFile ?? 'current'}, ${RUNS} runs per case\n`)
        const queryRuns = await Promise.all(queryCases.map((c) => Promise.all(Array.from({ length: RUNS }, () => call(queryModel, fillPrompt(queryTemplate, {
            claimText: c.claim,
            resolutionRules: c.rules,
            forecastStartStr: c.created,
            forecastEndStr: c.deadline,
        }), queryGenerationSchema)))))
        queryCases.forEach((c, i) => {
            const sets = queryRuns[i].map((r) => (Array.isArray(r.queries) ? r.queries as string[] : []).slice(0, 3))
            const house = (q: string) => /\bhouse\b/i.test(q)
            const senate = (q: string) => /\bsenate\b/i.test(q)
            const ok = sets.every((qs) => qs.some((q) => house(q) && !senate(q)) && qs.some((q) => senate(q) && !house(q)))
            if (!ok) failed += 1
            console.log(`${ok ? 'PASS' : 'FAIL'}  queries, ${c.name}: a separate query for the House seat count and for the Senate race`)
            sets.forEach((qs, k) => console.log(`      run ${k + 1}: ${qs.map((q) => `"${q}"`).join(' · ')}`))
        })
    }

    console.log(failed ? `\n${failed} case(s) failed` : '\nall cases passed')
    process.exit(failed ? 1 : 0)
}

main().catch((err) => {
    console.error(err)
    process.exit(2)
})
