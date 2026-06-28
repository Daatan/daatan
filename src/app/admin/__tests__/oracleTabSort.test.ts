import { describe, it, expect } from 'vitest'
import { sortRows, formatProviderChain, failureReasonTitle } from '../OracleTab'

type Row = { name: string; n: number | null; t: string | null }

const rows: Row[] = [
  { name: 'b', n: 2, t: '2026-06-01' },
  { name: 'a', n: 10, t: null },
  { name: 'c', n: null, t: '2026-06-03' },
]

describe('sortRows', () => {
  it('sorts numbers ascending and descending', () => {
    expect(sortRows(rows, r => r.n, 'asc').map(r => r.name)).toEqual(['b', 'a', 'c'])
    expect(sortRows(rows, r => r.n, 'desc').map(r => r.name)).toEqual(['a', 'b', 'c'])
  })

  it('sorts strings with locale compare', () => {
    expect(sortRows(rows, r => r.name, 'asc').map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(sortRows(rows, r => r.name, 'desc').map(r => r.name)).toEqual(['c', 'b', 'a'])
  })

  it('always sorts nulls last regardless of direction', () => {
    // c has n=null -> last in both directions
    expect(sortRows(rows, r => r.n, 'asc').at(-1)?.name).toBe('c')
    expect(sortRows(rows, r => r.n, 'desc').at(-1)?.name).toBe('c')
    // a has t=null -> last in both directions
    expect(sortRows(rows, r => r.t, 'asc').at(-1)?.name).toBe('a')
    expect(sortRows(rows, r => r.t, 'desc').at(-1)?.name).toBe('a')
  })

  it('does not mutate the input array', () => {
    const before = rows.map(r => r.name)
    sortRows(rows, r => r.n, 'asc')
    expect(rows.map(r => r.name)).toEqual(before)
  })
})

describe('formatProviderChain', () => {
  it('joins providers with arrows', () => {
    expect(formatProviderChain(['dataforseo', 'gdelt', 'caller'])).toBe('dataforseo → gdelt → caller')
  })
  it('returns empty string for an empty chain', () => {
    expect(formatProviderChain([])).toBe('')
  })
})

describe('failureReasonTitle', () => {
  it('maps known reason codes to a human hint', () => {
    expect(failureReasonTitle('no_search_results')).toMatch(/zero articles/i)
    expect(failureReasonTitle('http_5xx')).toMatch(/5xx/)
  })
  it('falls back to a generic hint for unknown codes', () => {
    expect(failureReasonTitle('some_new_code')).toMatch(/failure\/empty reason/i)
  })
})
