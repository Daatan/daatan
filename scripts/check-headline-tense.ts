/**
 * Live check for the headline prompt (#1823): every headline must be future tense, and
 * stay so after translation — present-tense headlinese read as news, esp. in Hebrew.
 *
 * Reads [{claim, old?}] from CLAIMS_FILE (e.g. recent prod claims), generates the headline
 * with the real prompt on `stageModel('headline')` (LLM_STAGE_MODELS, else gemini-2.5-flash)
 * via Vertex REST, applies the production guards, translates it to he/ru with the production
 * translate prompt's rules, and prints a table for review. Exits 1 if any English headline
 * lacks a future marker ("will"/"won't"/"no …").
 *
 *   CLAIMS_FILE=claims.json npx tsx scripts/check-headline-tense.ts
 *
 * Auth: VERTEX_ACCESS_TOKEN if set, else `gcloud auth print-access-token`. Project: daatan.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

process.env.SKIP_ENV_VALIDATION = '1'

async function main() {
  const { HEADLINE_PROMPT, polarityMatches } = await import('../src/lib/llm/headline')
  const { stageModel } = await import('../src/lib/llm/stageModels')
  const model = process.env.HEADLINE_MODEL || stageModel('headline', 'gemini-2.5-flash')
  const tModel = process.env.TRANSLATE_MODEL || stageModel('translation', 'gemini-2.5-flash')
  const token = process.env.VERTEX_ACCESS_TOKEN || execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const cases: { claim: string; old?: string }[] = JSON.parse(readFileSync(process.env.CLAIMS_FILE || 'claims.json', 'utf8'))

  async function gen(m: string, prompt: string): Promise<string> {
    const url = `https://aiplatform.googleapis.com/v1/projects/daatan/locations/global/publishers/google/models/${m}:generateContent`
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
      })
      if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const j = await res.json()
      return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim()
    }
  }
  const translate = (text: string, lang: string, claim: string) => gen(tModel, [
    `You are a professional translator localizing a prediction-market forecast into ${lang}.`, '',
    `Translate the text below into natural, fluent ${lang} as a native news editor would write it — convey the exact meaning, do not translate word for word.`, '',
    'Rules:', `- Keep proper nouns, organisation names and acronyms in their standard ${lang} form.`,
    '- Keep all numbers, dates and units exactly as given.', '- Match the concise register of news/analysis writing.',
    '- Return ONLY the translated text: no quotes, no notes, no explanation.',
    `\nContext — this text is part of the forecast: "${claim}". Use it only to disambiguate terms and grammatical agreement; translate ONLY the text below.`, '',
    'Text to translate:', text].join('\n'))

  const FUTURE = /\b(will|won't)\b|^no\b|^\S+ no\b/i
  let bad = 0
  for (const c of cases) {
    const claim = c.claim.replace(/^🤖\s*/, '')
    const raw = await gen(model, HEADLINE_PROMPT.replace('{claim}', () => claim))
    const h = raw.split('\n')[0].replace(/^headline:\s*/i, '').replace(/^["'“”«»]+|["'“”«»]+$/g, '').replace(/[.。]+$/, '').trim()
    const words = h.split(/\s+/).length
    const guard = words > 8 || h.length > 60 ? 'TOO_LONG' : !polarityMatches(claim, h) ? 'POLARITY' : 'ok'
    const future = claim.trim().endsWith('?') || FUTURE.test(h)
    if (!future) bad++
    const [he, ru] = guard === 'ok' ? await Promise.all([translate(h, 'Hebrew', claim), translate(h, 'Russian', claim)]) : ['', '']
    console.log(`${future ? 'OK ' : 'BAD'} [${guard}] ${c.old ?? ''} → ${h}\n      he: ${he}\n      ru: ${ru}`)
  }
  console.log(`\n${cases.length - bad}/${cases.length} future tense (${model}, translate ${tModel})`)
  process.exit(bad ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
