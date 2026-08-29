import { describe, it, expect } from 'vitest'
import { PROMPTS, type PromptName } from '../bedrock-prompts'
import { PROMPT_SCHEMAS, fingerprint } from '../promptPairs'
import { readLock } from '../promptLock'

// #1658: a structured prompt is prose plus a response schema whose `description`
// fields are model-facing instructions. Those two halves used to live in
// different systems under separate change control — Bedrock could go :6 → :7 with
// nothing in git, and a schema edit changed what the model received with no
// version moving at all. Neither number described what actually reached the model.
//
// This is the check that fixes that, and it is the reason the migration was worth
// doing: moving the text into git alone would have left the split intact. Editing
// either half now fails CI until the lock is regenerated, so the diff always shows
// that the prompt changed and by how many characters.
const lock = readLock()
const names = Object.keys(PROMPTS).sort() as PromptName[]

describe('prompt lock', () => {
  it('locks every prompt, and locks nothing that is not a prompt', () => {
    expect(Object.keys(lock.prompts).sort()).toEqual(names)
  })

  it.each(names)('%s: both halves match the lock', (name) => {
    const entry = lock.prompts[name]
    expect(entry, `${name} has no lock entry — run: npx tsx scripts/update-prompt-lock.ts`).toBeDefined()
    const { version: _version, ...locked } = entry!
    expect(
      locked,
      `${name} does not match prompts/prompt_versions.lock.json.\n` +
        'If the edit was intended, run `npx tsx scripts/update-prompt-lock.ts`, ' +
        'bump that entry\'s "version" if it changes model behaviour, and add a docs/PROMPTS.md row.',
    ).toEqual(fingerprint(name))
  })

  it('every entry carries a version', () => {
    for (const name of names) expect(lock.prompts[name]!.version).toMatch(/^v\d+$/)
  })

  it('names the schema export, so a hash change says where to look', () => {
    for (const name of names) {
      const entry = lock.prompts[name]!
      // A schema-free prompt locks prose only; the three schema fields move together.
      const hasSchema = PROMPT_SCHEMAS[name] !== null
      expect(entry.schema === null, `${name}`).toBe(!hasSchema)
      expect(entry.schema_hash === null, `${name}`).toBe(!hasSchema)
      expect(entry.schema_chars === null, `${name}`).toBe(!hasSchema)
    }
  })

  it('hashes the two halves independently', () => {
    // The two bot prompts share forecastBatchSchema and differ in prose, which
    // makes them the one pair that can show the halves are hashed separately —
    // a fingerprint keyed on either half alone would collide on one of these.
    const a = fingerprint('bot-forecast-generation')
    const b = fingerprint('bot-sourceless-forecast-generation')
    expect(a.schema_hash).toBe(b.schema_hash)
    expect(a.hash).not.toBe(b.hash)
  })

  it('gives every prompt a distinct prose hash', () => {
    const hashes = names.map((n) => fingerprint(n).hash)
    expect(new Set(hashes).size).toBe(names.length)
  })
})
