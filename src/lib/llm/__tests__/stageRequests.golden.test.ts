/**
 * Static golden of every LLM call's effective params by stage, and of the model each
 * role uses (daatan#2287). Read through the seam in `goldens/callSites.ts`: the
 * model-registry refactor changes that seam, never these goldens.
 */
import { describe, expect, it } from 'vitest'
import { LLM_STAGES } from '../stageModels'
import { effectiveModelRoles, effectiveStageParams, scanSource } from './goldens/callSites'
import { expectGolden } from './goldens/golden'

describe('LLM request goldens — call sites (daatan#2287)', () => {
  it('every stage in LLM_STAGES has a call site', () => {
    const { calls, reads } = scanSource()
    const seen = new Set([...calls.map((c) => c.stage), ...reads.map((r) => r.stage)])
    expect(LLM_STAGES.filter((s) => !seen.has(s))).toEqual([])
  })

  it('effective params per stage are unchanged', () => {
    expectGolden('stage-params', effectiveStageParams())
  })

  it('the model per role is unchanged', () => {
    expectGolden('model-roles', effectiveModelRoles())
  })
})
