import { describe, it, expect } from 'vitest'
import { getCommitmentLockReason } from '../commitment'

describe('getCommitmentLockReason', () => {
  const now = new Date('2026-07-04T00:00:00Z')

  it('returns null when open', () => {
    expect(
      getCommitmentLockReason({ settled: false, resolveByDatetime: new Date('2030-01-01') }, now),
    ).toBeNull()
  })

  it('does NOT lock when settled — settlement is notification-only', () => {
    expect(
      getCommitmentLockReason({ settled: true, resolveByDatetime: new Date('2030-01-01') }, now),
    ).toBeNull()
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

  it('"deadline-passed" fires regardless of settled when the deadline has passed', () => {
    expect(
      getCommitmentLockReason({ settled: true, resolveByDatetime: new Date('2020-01-01') }, now),
    ).toBe('deadline-passed')
  })

  describe('impossibility-pinned third arm', () => {
    it('locks when claimDeadline has passed and agrees with resolveByDatetime (still future)', () => {
      // claimDeadline passed 1h ago; resolveByDatetime is 11h later — within the
      // 72h tolerance and still in the future, so 'deadline-passed' hasn't fired.
      const claimDeadline = new Date(now.getTime() - 3600_000)
      const resolveByDatetime = new Date(now.getTime() + 11 * 3600_000)
      expect(
        getCommitmentLockReason({ settled: false, resolveByDatetime, claimDeadline }, now),
      ).toBe('impossibility-pinned')
    })

    it('does NOT lock when claimDeadline has NOT passed yet', () => {
      const claimDeadline = new Date(now.getTime() + 3600_000)
      const resolveByDatetime = new Date(now.getTime() + 3600_000)
      expect(
        getCommitmentLockReason({ settled: false, resolveByDatetime, claimDeadline }, now),
      ).toBeNull()
    })

    it('does NOT lock when claimDeadline passed but diverges from resolveByDatetime beyond tolerance', () => {
      const claimDeadline = new Date(now.getTime() - 3600_000)
      const resolveByDatetime = new Date(now.getTime() + 100 * 3600_000) // >72h out
      expect(
        getCommitmentLockReason({ settled: false, resolveByDatetime, claimDeadline }, now),
      ).toBeNull()
    })

    it('does NOT lock when claimDeadline is absent (unclassified forecast)', () => {
      expect(
        getCommitmentLockReason(
          { settled: false, resolveByDatetime: new Date(now.getTime() + 3600_000), claimDeadline: null },
          now,
        ),
      ).toBeNull()
    })

    it('"deadline-passed" takes precedence once resolveByDatetime itself has passed', () => {
      const claimDeadline = new Date(now.getTime() - 3600_000)
      const resolveByDatetime = new Date(now.getTime() - 1800_000)
      expect(
        getCommitmentLockReason({ settled: false, resolveByDatetime, claimDeadline }, now),
      ).toBe('deadline-passed')
    })
  })
})
