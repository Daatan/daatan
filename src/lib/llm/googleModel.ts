/**
 * The one Gemini model id the direct-Google calls use (daatan#1763): the Vertex and
 * Developer-API legs of the main chain, the grounded date lookup, and the bot
 * direct-Gemini leg. One place, so a model retirement is a one-line change rather than
 * a grep. The AI panel's Vertex member is the exception — it must be a non-thinking
 * model, see `VERTEX_PANEL_MODEL` in panel/roster.ts.
 *
 * `gemini-3.8-flash` replaces `gemini-2.5-flash`, which Vertex stops serving on
 * 2027-03-31. Verified GA on Vertex `global` 2026-10-03 (publisher-model metadata
 * `launchStage: GA`, plus live structured-output and `googleSearch` smoke calls).
 *
 * Gemini 3 notes that matter here:
 * - Responses carry a `thoughtSignature` on the text part. Every call in this codebase
 *   is a single user turn with no function-calling round-trip, so there is nothing to
 *   circulate; a future multi-turn or tool-calling caller MUST echo the model's parts
 *   (signatures included) back verbatim.
 * - The answer may be split across several text parts — read it with
 *   `joinCandidateText`, never `parts[0].text`.
 *
 * `GOOGLE_GEMINI_MODEL` overrides it (e.g. `gemini-3.5-flash-lite`, price-identical to
 * 2.5 Flash). Read once at module load. Note the prod/staging deploy scripts do not
 * pass it through yet — wire it into docker-compose + blue-green-deploy.sh before
 * relying on it there.
 */
export const GEMINI_MODEL = process.env.GOOGLE_GEMINI_MODEL || 'gemini-3.8-flash'

interface CandidatePart {
  text?: string
  /** Set on thought-summary parts, which only appear with `includeThoughts`; never answer text. */
  thought?: boolean
}

/** The answer text of a generateContent candidate: every non-thought text part, joined. */
export function joinCandidateText(parts: readonly CandidatePart[] | undefined): string | undefined {
  const texts = (parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text as string)
  return texts.length > 0 ? texts.join('') : undefined
}
