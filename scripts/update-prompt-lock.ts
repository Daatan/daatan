/**
 * Regenerate prompts/prompt_versions.lock.json (#1658).
 *
 * Run with: npx tsx scripts/update-prompt-lock.ts
 *
 * The lock pins both halves of every prompt — the prose in PROMPTS and the
 * `description` fields of its paired response schema — because either one alone
 * describes half of what the model receives. `promptLock.test.ts` fails when the
 * code and this file disagree; running this is how you accept a change you meant
 * to make.
 *
 * `version` is deliberately NOT touched here. It is the one field a human owns:
 * bump it in the same commit when the edit changes model behaviour materially,
 * and add a row to docs/PROMPTS.md saying what changed and why. A script that
 * bumped it automatically would restore exactly the property #1658 removed — a
 * number that increments without anyone deciding it means something.
 */
import { writeFileSync } from 'fs'
import path from 'path'
import type { PromptLock } from '../src/lib/llm/promptLock'

// The pairing table imports the services that own the schemas, and those reach
// src/env.ts, which validates at module load — including a rule that rejects
// obviously-fake secrets. None of it is used here (this script reads text and
// writes JSON), so skip the check rather than make a lock regeneration depend on
// having real credentials to hand.
process.env.SKIP_ENV_VALIDATION = '1'

async function main() {
    // Lazy so the placeholders above are in place before env.ts is evaluated.
    const { PROMPTS } = await import('../src/lib/llm/bedrock-prompts')
    const { fingerprint } = await import('../src/lib/llm/promptPairs')
    const { LOCK_COMMENT, LOCK_PATH, readLock } = await import('../src/lib/llm/promptLock')

    const existing = readLock()
    const next: PromptLock['prompts'] = {}
    const changed: string[] = []

    for (const name of Object.keys(PROMPTS).sort()) {
        const key = name as keyof typeof PROMPTS
        next[key] = { version: existing.prompts[key]?.version ?? 'v1', ...fingerprint(key) }
        if (JSON.stringify(next[key]) !== JSON.stringify(existing.prompts[key])) changed.push(name)
    }

    writeFileSync(LOCK_PATH, JSON.stringify({ _comment: LOCK_COMMENT, prompts: next }, null, 2) + '\n')

    const file = path.basename(LOCK_PATH)
    console.log(
        changed.length === 0
            ? `${file} already up to date (${Object.keys(next).length} prompts)`
            : `${file} updated — changed: ${changed.join(', ')}\n` +
              'Bump "version" by hand for any of these that changes model behaviour, and add a docs/PROMPTS.md row.',
    )
}

void main()
