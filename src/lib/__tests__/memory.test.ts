import { describe, it, expect } from 'vitest'
import { memoryUsageMb, toMb } from '@/lib/memory'

describe('memoryUsageMb (#1725)', () => {
  it('rounds bytes to whole megabytes', () => {
    expect(toMb(0)).toBe(0)
    expect(toMb(1048576)).toBe(1)
    expect(toMb(1.5 * 1048576)).toBe(2)
    expect(toMb(1_850_000_000)).toBe(1764)
  })

  it('reports the live process in MB with the heap inside its total', () => {
    const m = memoryUsageMb()
    expect(m.rss).toBeGreaterThan(0)
    expect(m.heapUsed).toBeGreaterThan(0)
    expect(m.heapUsed).toBeLessThanOrEqual(m.heapTotal)
    expect(m.external).toBeGreaterThanOrEqual(0)
    expect(m.uptimeMin).toBeGreaterThanOrEqual(0)
    for (const v of Object.values(m)) expect(Number.isInteger(v)).toBe(true)
  })
})
