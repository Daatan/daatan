import { readFileSync } from 'fs'
import path from 'path'
import type { PromptName } from './bedrock-prompts'
import type { PromptFingerprint } from './promptPairs'

export interface PromptLockEntry extends PromptFingerprint {
    /** Human-owned. Bump when an edit changes model behaviour materially. */
    version: string
}

export interface PromptLock {
    _comment?: string
    prompts: Partial<Record<PromptName, PromptLockEntry>>
}

export const LOCK_PATH = path.join(process.cwd(), 'prompts', 'prompt_versions.lock.json')

export const LOCK_COMMENT =
    'Source of truth for src/lib/llm/__tests__/promptLock.test.ts. Each entry pins BOTH halves of the text one prompt sends: `hash`/`chars` cover the prose in PROMPTS (hashed with {{appName}} still a placeholder), and `schema_hash`/`schema_chars` cover the paired response schema as JSON.stringify emits it — its `description` fields are model-facing instructions, and retro measured the schema half at 27% of its extractor prompt (retro#700). `schema: null` means the prompt genuinely has no schema; its prose is still locked. `chars` sits beside each hash so growth shows as a number in the diff rather than as an opaque hash change. Hashes are the first 16 hex chars of SHA-256. Regenerate with `npx tsx scripts/update-prompt-lock.ts`; `version` is never written by the script — bump it by hand in the same commit when the edit changes model behaviour, and add a row to docs/PROMPTS.md. Versions all start at v1: the Bedrock version numbers these prompts carried until #1658 counted edits to the prose alone, so they do not describe the same thing and are not carried forward (issue #1658 records what each was on).'

export function readLock(): PromptLock {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf-8')) as PromptLock
}
