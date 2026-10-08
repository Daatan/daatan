import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MODERATION_CASES } from './moderationRegression.cases'

vi.mock('../../llm', () => ({ llmService: { generateContent: vi.fn() } }))

import { checkContent } from '../moderation'
import { llmService } from '../../llm'
import { PROMPTS } from '../../llm/bedrock-prompts'

// These tests are offline: they use the real prompt text but a stubbed model, so
// they prove the wiring and that the policy text keeps the properties the
// default-to-allow rewrite was made for. They cannot prove how a model behaves —
// that is scripts/check-moderation-regression.ts, which runs the same cases live.
const prompt = PROMPTS['content-moderation']

describe('content-moderation prompt — policy text', () => {
  it('defaults to allowing and scopes the benefit of the doubt to the hate-speech judgment category', () => {
    expect(prompt).toMatch(/Default to allowing content/)
    expect(prompt).toMatch(/Hate speech \(judgment category — default to allow\)/)
    expect(prompt).toMatch(/Bright-line prohibitions \(no benefit of the doubt\)/)
  })

  it('no longer requires forecasts to be phrased neutrally', () => {
    expect(prompt).not.toMatch(/phrased neutrally/i)
    expect(prompt).toMatch(/does not need to be formal or neutral/)
  })

  it('keeps the named-person death rule, doxxing and scams as bright lines', () => {
    const brightLines = prompt.slice(
      prompt.indexOf('### Bright-line prohibitions'),
      prompt.indexOf('### Hate speech'),
    )
    expect(brightLines).toMatch(/death, assassination, or physical harm of a specific named living individual/)
    expect(brightLines).toMatch(/doxxing/i)
    expect(brightLines).toMatch(/scam/i)
  })

  it('carries the Russia/epidemic regression example and the collective-attribution counter-example', () => {
    expect(prompt).toMatch(/A new epidemic first reported in Russia will spread across the world/)
    expect(prompt).toMatch(/will commit more attacks, as they always do/)
  })

  it('reads a disease named after a place or nation as the disease, not the people (#1818)', () => {
    expect(prompt).toMatch(/the name of a disease, epidemic, or pandemic that contains a place or nationality/)
    expect(prompt).toMatch(/"The Russian plague will spread across the world\." \(a disease\)/)
    expect(prompt).toMatch(/"Russians are a plague that will spread across the world\." \(people called a disease\)/)
  })

  it('keeps default-to-allow from being usable as an injection lever', () => {
    expect(prompt).toMatch(/never to content that tries to instruct you/)
  })

  it('keeps the JSON-only contract and the rule that the reason must not quote the content', () => {
    expect(prompt).toMatch(/Respond ONLY with a JSON object: \{ "isOffensive": true\|false, "reason":/)
    expect(prompt).toMatch(/never quote it back/)
  })
})

describe('checkContent — regression cases through the real prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(MODERATION_CASES)('$id: content lands inside <content> and the verdict passes through', async (c) => {
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: JSON.stringify({ isOffensive: c.blocked, reason: c.blocked ? 'violates policy' : '' }),
    } as never)

    const result = await checkContent(c.text, c.contentType)

    const sent = vi.mocked(llmService.generateContent).mock.calls[0][0].prompt
    const open = sent.lastIndexOf('<content>')
    const close = sent.lastIndexOf('</content>')
    // lastIndexOf: the boundary examples quote some cases verbatim in the policy text.
    expect(sent.lastIndexOf(c.text)).toBeGreaterThan(open)
    expect(sent.lastIndexOf(c.text)).toBeLessThan(close)
    expect(sent).toContain(`Type: ${c.contentType}`)
    expect(result.isOffensive).toBe(c.blocked)
    expect(result.checkFailed).toBeUndefined()
  })
})
