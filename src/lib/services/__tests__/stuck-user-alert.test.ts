import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockNotifyStuckUser = vi.fn()
vi.mock('@/lib/services/telegram', () => ({
  notifyStuckUser: (...args: unknown[]) => mockNotifyStuckUser(...args),
}))

import {
  recordValidationFailure,
  resetStuckUserTracker,
  stuckUserRouteLabel,
  STUCK_USER_WINDOW_MS,
} from '../stuck-user-alert'

const alice = { id: 'alice', name: 'Alice' }
const bob = { id: 'bob', name: 'Bob' }
const MIN = 60_000

function fail(user: { id: string; name: string }, now: number, issue = 'tags: Too big', route = 'POST /api/forecasts') {
  recordValidationFailure({ user, route, issue, now })
}

describe('stuck-user alert (#1787)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStuckUserTracker()
  })

  it('alerts once on the 3rd failure within the window', () => {
    fail(alice, 0)
    fail(alice, 1 * MIN)
    expect(mockNotifyStuckUser).not.toHaveBeenCalled()
    fail(alice, 2 * MIN)
    expect(mockNotifyStuckUser).toHaveBeenCalledTimes(1)
    expect(mockNotifyStuckUser.mock.calls[0][0]).toMatchObject({ count: 3, firstIssue: 'tags: Too big', windowMinutes: 10 })
  })

  it('a burst of 8 clicks produces one alert', () => {
    for (let i = 0; i < 8; i++) fail(alice, i * 15_000)
    expect(mockNotifyStuckUser).toHaveBeenCalledTimes(1)
  })

  it('does not alert when failures are spread wider than the window', () => {
    fail(alice, 0)
    fail(alice, 6 * MIN)
    fail(alice, 12 * MIN)
    expect(mockNotifyStuckUser).not.toHaveBeenCalled()
  })

  it('alerts again for a user still stuck after the window has passed', () => {
    for (let i = 0; i < 3; i++) fail(alice, i * MIN)
    const later = 2 * MIN + STUCK_USER_WINDOW_MS + 1
    for (let i = 0; i < 3; i++) fail(alice, later + i * MIN, 'claimText: Too small')
    expect(mockNotifyStuckUser).toHaveBeenCalledTimes(2)
    expect(mockNotifyStuckUser.mock.calls[1][0].firstIssue).toBe('claimText: Too small')
  })

  it('counts users independently and reports every route hit', () => {
    fail(alice, 0)
    fail(bob, 0)
    fail(alice, MIN, 'x', 'POST /api/forecasts/[id]/publish')
    fail(bob, MIN)
    expect(mockNotifyStuckUser).not.toHaveBeenCalled()
    fail(alice, 2 * MIN)
    expect(mockNotifyStuckUser).toHaveBeenCalledTimes(1)
    expect(mockNotifyStuckUser.mock.calls[0][0]).toMatchObject({
      user: alice,
      routes: ['POST /api/forecasts', 'POST /api/forecasts/[id]/publish'],
    })
  })

  it('watches only POST create and publish', () => {
    expect(stuckUserRouteLabel('POST', '/api/forecasts')).toBe('POST /api/forecasts')
    expect(stuckUserRouteLabel('POST', '/api/forecasts/cmabc/publish')).toBe('POST /api/forecasts/[id]/publish')
    expect(stuckUserRouteLabel('GET', '/api/forecasts')).toBeNull()
    expect(stuckUserRouteLabel('POST', '/api/forecasts/cmabc/commit')).toBeNull()
  })
})
