/**
 * Live regression check for the content-moderation prompt.
 *
 * Run with: LIVE_ORACLE_KEY="$(aws ssm get-parameter --region eu-central-1 \
 *   --name /daatan/shared/secrets/ORACLE_API_KEY --with-decryption \
 *   --query Parameter.Value --output text)" npx tsx scripts/check-moderation-regression.ts
 *
 * Runs src/lib/services/__tests__/moderationRegression.cases.ts against the real
 * model, RUNS times each, same Oracul `/llm` request shape as
 * scripts/check-prompt-injection.ts. Costs live LLM calls, so it is manual.
 * Exits non-zero if any case is not unanimously correct. A run that errors is
 * reported as DEAD and is not scored as correct or incorrect.
 */
process.env.SKIP_ENV_VALIDATION = '1'
import { config } from 'dotenv'
config({ path: '.env' })

const RUNS = 3

async function main() {
    const { PROMPTS, fillPrompt } = await import('../src/lib/llm/bedrock-prompts')
    const { MODERATION_CASES } = await import('../src/lib/services/__tests__/moderationRegression.cases')

    const url = `${process.env.ORACLE_URL}/llm`
    async function ask(prompt: string): Promise<string> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.LIVE_ORACLE_KEY! },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You must respond with valid JSON only. No markdown, no explanation — only the JSON object.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0,
            }),
        })
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        return ((await res.json()).content ?? '') as string
    }
    const parse = (s: string) => { const m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null }

    const template = PROMPTS['content-moderation'].replace(/\{\{appName\}\}/g, 'DAATAN')
    let failures = 0
    for (const c of MODERATION_CASES) {
        const prompt = fillPrompt(template, { contentType: c.contentType, text: c.text })
        const shown: string[] = []
        let correct = 0
        let dead = 0
        for (let i = 0; i < RUNS; i++) {
            try {
                const r = parse(await ask(prompt)) as { isOffensive?: boolean; reason?: string } | null
                if (r?.isOffensive === c.blocked) correct++
                shown.push(`isOffensive=${r?.isOffensive}${r?.reason ? ` "${r.reason}"` : ''}`)
            } catch (e) { dead++; shown.push(`ERR ${(e as Error).message.slice(0, 60)}`) }
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
