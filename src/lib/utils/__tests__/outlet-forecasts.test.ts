import { describe, it, expect } from 'vitest'
import {
  articleDay, forecastState, runningTrend, sortOutletForecasts, TREND_POINTS, type OutletForecastRow,
} from '../outlet-forecasts'
import { brierGrade } from '../brier-grade'
import { brierTone } from '@/components/leaderboard/LeaderboardParts'

const row = (over: Partial<OutletForecastRow>): OutletForecastRow => ({
  forecastId: 'f', href: '/forecasts/f', title: 'T', state: 'open', articles: 1, lean: 50, trend: [50],
  lastArticle: '2026-11-01', ...over,
})

describe('forecastState', () => {
  it('maps statuses to what the table shows', () => {
    expect(forecastState('ACTIVE')).toBe('open')
    expect(forecastState('PENDING')).toBe('pending')
    expect(forecastState('RESOLVED_CORRECT')).toBe('cameTrue')
    expect(forecastState('RESOLVED_WRONG')).toBe('didNotHappen')
    expect(forecastState('VOID')).toBe('annulled')
    expect(forecastState('UNRESOLVABLE')).toBe('annulled')
  })
})

describe('articleDay', () => {
  const added = new Date('2026-11-20T15:00:00Z')

  it('takes the reported day when it reads as a date', () => {
    expect(articleDay('2026-11-03T08:00:00+02:00', added)).toBe('2026-11-03')
    expect(articleDay('2026-11-03', added)).toBe('2026-11-03')
  })

  it('falls back to when Daatan recorded it', () => {
    expect(articleDay(null, added)).toBe('2026-11-20')
    expect(articleDay('Tue, 3 Nov 2026', added)).toBe('2026-11-20')
    expect(articleDay('2026-02-31', added)).toBe('2026-11-20')
  })
})

describe('runningTrend', () => {
  const pct = (v: number) => Math.round(v * 100)

  it('is the mean after each article', () => {
    expect(runningTrend([1, 0, 0.5], pct)).toEqual([100, 50, 50])
  })

  it('thins a long run to TREND_POINTS, keeping the first and last reading', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i < 50 ? 1 : 0))
    const trend = runningTrend(values, pct)
    expect(trend).toHaveLength(TREND_POINTS)
    expect(trend[0]).toBe(100)
    expect(trend[trend.length - 1]).toBe(50)
  })
})

describe('sortOutletForecasts', () => {
  const rows = [
    row({ forecastId: 'resolvedNew', state: 'cameTrue', lastArticle: '2026-11-20', lean: 80, articles: 2, title: 'b' }),
    row({ forecastId: 'openOld', state: 'open', lastArticle: '2026-10-01', lean: 30, articles: 9, title: 'c' }),
    row({ forecastId: 'pendingNew', state: 'pending', lastArticle: '2026-11-10', lean: 60, articles: 1, title: 'a' }),
  ]
  const ids = (r: OutletForecastRow[]) => r.map((x) => x.forecastId)

  it('defaults to open forecasts first, each group newest article first', () => {
    expect(ids(sortOutletForecasts(rows))).toEqual(['pendingNew', 'openOld', 'resolvedNew'])
  })

  it('sorts numbers biggest first and text A→Z on first click, either way on the second', () => {
    expect(ids(sortOutletForecasts(rows, 'lean'))).toEqual(['resolvedNew', 'pendingNew', 'openOld'])
    expect(ids(sortOutletForecasts(rows, 'lean', 'asc'))).toEqual(['openOld', 'pendingNew', 'resolvedNew'])
    expect(ids(sortOutletForecasts(rows, 'title'))).toEqual(['pendingNew', 'resolvedNew', 'openOld'])
    expect(ids(sortOutletForecasts(rows, 'articles'))).toEqual(['openOld', 'resolvedNew', 'pendingNew'])
  })

  it('does not reorder its input', () => {
    const before = ids(rows)
    sortOutletForecasts(rows, 'lean')
    expect(ids(rows)).toEqual(before)
  })
})

describe('brierGrade', () => {
  it('uses the leaderboard colour cut-offs, so word and colour agree', () => {
    expect([0.05, 0.1, 0.15, 0.2, 0.22, 0.25, 0.4].map(brierGrade))
      .toEqual(['excellent', 'excellent', 'good', 'good', 'fair', 'poor', 'poor'])
    expect(brierTone(0.1)).toBe('text-emerald-400')
    expect(brierTone(0.2)).toBe('text-lime-400')
    expect(brierTone(0.24)).toBe('text-yellow-400')
    expect(brierTone(0.25)).toBe('text-red-400')
  })
})
