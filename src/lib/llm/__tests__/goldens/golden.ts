import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { expect } from 'vitest'

/**
 * Golden files that pin today's outgoing LLM requests (daatan#2287).
 *
 * The model-registry refactor moves model ids and call params out of the call sites
 * and into one registry. These goldens were captured from the code BEFORE that move,
 * so a refactor that changes what we actually send fails here with a diff.
 *
 * Regenerate ONLY deliberately, and say why in the PR:
 *   UPDATE_GOLDENS=1 npx vitest run src/lib/llm/__tests__/*.golden.test.ts
 */
const DIR = path.resolve(process.cwd(), 'src/lib/llm/__tests__/goldens')

export function expectGolden(name: string, actual: unknown): void {
  const file = path.join(DIR, `${name}.json`)
  const json = JSON.stringify(actual, null, 2) + '\n'
  if (process.env.UPDATE_GOLDENS === '1') {
    writeFileSync(file, json)
    return
  }
  if (!existsSync(file)) {
    throw new Error(`missing golden ${name}.json — regenerate deliberately with UPDATE_GOLDENS=1`)
  }
  expect(JSON.parse(json)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}
