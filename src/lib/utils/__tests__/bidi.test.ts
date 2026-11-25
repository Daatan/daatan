import { describe, it, expect } from 'vitest'
import { bidiIsolate } from '../bidi'

describe('bidiIsolate', () => {
  it('wraps text in first-strong isolate marks (FSI … PDI)', () => {
    expect(bidiIsolate('Will X happen?')).toBe('⁨Will X happen?⁩')
  })

  it('leaves the visible text unchanged', () => {
    expect(bidiIsolate('Nov 24, 2026').replace(/[⁨⁩]/g, '')).toBe('Nov 24, 2026')
  })
})
