import { describe, it, expect } from 'vitest'
import { getCommitmentLockReason } from '../commitment'

describe('getCommitmentLockReason', () => {
  const now = new Date('2026-07-04T00:00:00Z')

  it('returns null when open', () => {
    expect(
      getCommitmentLockReason({ settled: false, resolveByDatetime: new Date('2030-01-01') }, now),
    ).toBeNull()
  })

  it('returns "settled" when the outcome has been pinned', () => {
    expect(
      getCommitmentLockReason({ settled: true, resolveByDatetime: new Date('2030-01-01') }, now),
    ).toBe('settled')
  })

  it('returns "deadline-passed" when resolveByDatetime has passed', () => {
    expect(
      getCommitmentLockReason({ settled: false, resolveByDatetime: new Date('2020-01-01') }, now),
    ).toBe('deadline-passed')
  })

  it('returns "deadline-passed" at exactly the deadline instant', () => {
    expect(
      getCommitmentLockReason({ settled: false, resolveByDatetime: now }, now),
    ).toBe('deadline-passed')
  })

  it('prefers "settled" when both conditions hold', () => {
    expect(
      getCommitmentLockReason({ settled: true, resolveByDatetime: new Date('2020-01-01') }, now),
    ).toBe('settled')
  })
})
