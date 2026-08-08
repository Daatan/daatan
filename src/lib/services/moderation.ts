import { SchemaType, type Schema } from '@google/generative-ai'
import { getPromptTemplate, fillPrompt } from '../llm/bedrock-prompts'
import { llmService } from '../llm'
import { createLogger } from '@/lib/logger'
import { z } from 'zod'

const log = createLogger('moderation-service')

export const moderationSchema: Schema = {
  description: "Result of content moderation check",
  type: SchemaType.OBJECT,
  properties: {
    isOffensive: {
      type: SchemaType.BOOLEAN,
      description: "Whether the content violates safety policies",
    },
    reason: {
      type: SchemaType.STRING,
      description: "Brief explanation of the violation if isOffensive is true",
    },
  },
  required: ["isOffensive", "reason"],
}

export interface ModerationResult {
  isOffensive: boolean
  reason: string
  // true when the LLM check itself failed (timeout, provider outage, malformed
  // response) rather than returning a verdict. Callers should still publish the
  // content (no hard block on a transient provider error) but persist this flag
  // on the created record so it lands in manual review instead of being
  // silently treated as "checked and clean".
  checkFailed?: boolean
}

const moderationResultSchema = z.object({
  isOffensive: z.boolean(),
  reason: z.string(),
})

/**
 * Check if text content is offensive or violates policies.
 */
export async function checkContent(
  text: string,
  contentType: 'forecast' | 'comment'
): Promise<ModerationResult> {
  // Fast path for empty content
  if (!text.trim()) {
    return { isOffensive: false, reason: '' }
  }

  try {
    const template = await getPromptTemplate('content-moderation')
    const prompt = fillPrompt(template, {
      text: text.substring(0, 5000), // Cap length for safety
      contentType,
    })

    const result = await llmService.generateContent({
      prompt,
      schema: moderationSchema,
      temperature: 0, // High consistency for moderation
    })

    const parsed = moderationResultSchema.parse(JSON.parse(result.text))
    
    if (parsed.isOffensive) {
      log.warn({ contentType, text: text.substring(0, 100), reason: parsed.reason }, 'Content blocked by AI moderation')
    }

    return parsed
  } catch (error) {
    log.error({ err: error, contentType }, 'Moderation check failed, allowing content but flagging for manual review')
    // Fail safe, not fail silent: don't hard-block publishing on a transient
    // provider error, but flag the content so an admin reviews it — never
    // return a bare "not offensive" that looks identical to a real pass.
    return { isOffensive: false, reason: '', checkFailed: true }
  }
}
