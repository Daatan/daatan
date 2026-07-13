import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { FALLBACK_PROMPTS } from '../bedrock-prompts'

// prompts/express-prediction.txt is the human-edited copy pasted into the
// Bedrock draft; FALLBACK_PROMPTS is what actually runs when Bedrock is
// unavailable. The two silently drifted once (caught in the #1086 review), so
// this locks them together. Other prompts' .txt files are historically stale
// and are deliberately not asserted here — sync them before adding a pair.
describe('prompt copies stay in sync', () => {
  it('express-prediction: prompts/*.txt matches the code fallback', () => {
    const txt = readFileSync(
      path.join(process.cwd(), 'prompts/express-prediction.txt'),
      'utf-8',
    ).trim()
    const fallback = (FALLBACK_PROMPTS['express-prediction'] ?? '')
      .replace(/\{\{appName\}\}/g, 'DAATAN')
      .trim()
    expect(txt).toBe(fallback)
  })
})
