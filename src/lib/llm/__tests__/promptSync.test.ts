import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { FALLBACK_PROMPTS } from '../bedrock-prompts'

// prompts/*.txt are the human-edited copies pasted into the Bedrock drafts;
// FALLBACK_PROMPTS is what actually runs when Bedrock is unavailable. The two
// silently drifted once (caught in the #1086 review) and then again on five
// prompts, two of which mattered: forecast-quality-validation lost the
// ffceb8ed date-rule fix and bot-forecast-generation lost its stricter quality
// rules — both fixed in git but never promoted to Bedrock. Asserting only
// express-prediction is what let that happen, so every .txt is locked now.
//
// A prompt with no .txt (guess-chances, temporal-classifier, panel-estimate,
// panel-estimate-grounded) is not asserted: those have no Bedrock prompt to be
// the source file for, and run off the fallback by design.
const PROMPTS_DIR = path.join(process.cwd(), 'prompts')
const txtNames = readdirSync(PROMPTS_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''))
  .sort()

describe('prompt copies stay in sync', () => {
  it('finds .txt files to check', () => {
    expect(txtNames.length).toBeGreaterThan(0)
  })

  it.each(txtNames)('%s: prompts/*.txt matches the code fallback', (name) => {
    const fallback = FALLBACK_PROMPTS[name as keyof typeof FALLBACK_PROMPTS]
    // A .txt with no fallback key means the pair has come apart — either the
    // prompt was renamed in code or the file is an orphan.
    expect(fallback, `prompts/${name}.txt has no FALLBACK_PROMPTS entry`).toBeDefined()

    const txt = readFileSync(path.join(PROMPTS_DIR, `${name}.txt`), 'utf-8').trim()
    expect(txt).toBe((fallback ?? '').replace(/\{\{appName\}\}/g, 'DAATAN').trim())
  })
})
