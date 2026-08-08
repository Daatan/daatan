import { describe, it, expect } from 'vitest'
import { detectPinContradiction } from '../pin-contradiction'

describe('detectPinContradiction', () => {
  it('contradicts when settled=true at low confidence but resolver declares correct (the F-35-shaped incident)', () => {
    const result = detectPinContradiction(true, 3, 'BINARY', 'correct')
    expect(result).toEqual({ contradicts: true, impliedOutcome: 'wrong', isSettled: true })
  })

  it('contradicts when settled=true at high confidence but resolver declares wrong', () => {
    const result = detectPinContradiction(true, 97, 'BINARY', 'wrong')
    expect(result).toEqual({ contradicts: true, impliedOutcome: 'correct', isSettled: true })
  })

  it('does not contradict when settled=true and the declared outcome agrees', () => {
    const result = detectPinContradiction(true, 3, 'BINARY', 'wrong')
    expect(result).toEqual({ contradicts: false, impliedOutcome: 'wrong', isSettled: true })
  })

  it('contradicts on extreme confidence alone, without settled=true', () => {
    const result = detectPinContradiction(false, 92, 'BINARY', 'wrong')
    expect(result).toEqual({ contradicts: true, impliedOutcome: 'correct', isSettled: false })
  })

  it('is false just below the extreme-band threshold (90 is extreme, 89 is not)', () => {
    const result = detectPinContradiction(false, 89, 'BINARY', 'wrong')
    expect(result).toEqual({ contradicts: false, impliedOutcome: null, isSettled: false })
  })

  it('is false at exactly the high boundary agreeing with the outcome', () => {
    const result = detectPinContradiction(false, 90, 'BINARY', 'correct')
    expect(result.impliedOutcome).toBe('correct')
    expect(result.contradicts).toBe(false)
  })

  it('is false when settled=true but confidence has drifted back inside the band (no reliable direction)', () => {
    const result = detectPinContradiction(true, 45, 'BINARY', 'correct')
    expect(result).toEqual({ contradicts: false, impliedOutcome: null, isSettled: true })
  })

  it('is false for MULTIPLE_CHOICE regardless of confidence', () => {
    const result = detectPinContradiction(true, 3, 'MULTIPLE_CHOICE', 'correct')
    expect(result).toEqual({ contradicts: false, impliedOutcome: null, isSettled: true })
  })

  it('is false for void/unresolvable outcomes even with a contradicting pin', () => {
    expect(detectPinContradiction(true, 3, 'BINARY', 'void').contradicts).toBe(false)
    expect(detectPinContradiction(true, 3, 'BINARY', 'unresolvable').contradicts).toBe(false)
  })

  it('is false when confidence is null (no estimate to compare against)', () => {
    const result = detectPinContradiction(true, null, 'BINARY', 'correct')
    expect(result).toEqual({ contradicts: false, impliedOutcome: null, isSettled: true })
  })

  it('surfaces isSettled=false when settled is null/undefined, still checking the band', () => {
    expect(detectPinContradiction(null, 5, 'BINARY', 'correct').isSettled).toBe(false)
    expect(detectPinContradiction(undefined, 5, 'BINARY', 'correct').isSettled).toBe(false)
  })
})
