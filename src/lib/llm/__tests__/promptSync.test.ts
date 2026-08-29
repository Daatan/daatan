import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { PROMPTS } from '../bedrock-prompts'

// prompts/*.txt is the human-editable mirror of PROMPTS, which is what actually
// runs. The two silently drifted once (caught in the #1086 review) and then
// again on five prompts, two of which mattered: forecast-quality-validation
// lost the ffceb8ed date-rule fix and bot-forecast-generation lost its stricter
// quality rules — both fixed in git but never promoted to Bedrock. Asserting
// only express-prediction is what let that happen.
//
// #1658 removed the third copy (Bedrock, reached at runtime via SSM), so these
// two are now the whole story — and the check runs BOTH ways. Before #1658 a
// prompt with no .txt was simply unasserted, which is how temporal-classifier
// came to serve production from Bedrock with no drift guard of any kind. A
// one-directional check cannot catch the file that was never created.
const PROMPTS_DIR = path.join(process.cwd(), 'prompts')
const txtNames = readdirSync(PROMPTS_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''))
  .sort()
const promptNames = Object.keys(PROMPTS).sort()

describe('prompt copies stay in sync', () => {
  it('every PROMPTS entry has a prompts/*.txt, and vice versa', () => {
    expect(txtNames).toEqual(promptNames)
  })

  it.each(promptNames)('%s: prompts/*.txt matches the code', (name) => {
    const txt = readFileSync(path.join(PROMPTS_DIR, `${name}.txt`), 'utf-8').trim()
    const code = PROMPTS[name as keyof typeof PROMPTS].replace(/\{\{appName\}\}/g, 'DAATAN').trim()
    expect(txt).toBe(code)
  })
})
