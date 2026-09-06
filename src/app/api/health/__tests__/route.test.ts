import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services/health', () => ({
  checkDatabaseHealth: vi.fn(),
}))

vi.mock('@/lib/memory', () => ({
  memoryUsageMb: vi.fn(),
  toMb: (bytes: number) => Math.round(bytes / 1048576),
}))

import { checkDatabaseHealth } from '@/lib/services/health'
import { memoryUsageMb } from '@/lib/memory'
import { GET } from '../route'

const checkDb = vi.mocked(checkDatabaseHealth)
const usage = vi.mocked(memoryUsageMb)

const baseMemory = { rss: 400, heapUsed: 200, heapTotal: 300, external: 10, uptimeMin: 5 }

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkDb.mockResolvedValue(true)
    usage.mockReturnValue(baseMemory)
  })

  it('reports ok with 200 when the DB is up and memory is nominal', async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.db).toBe(true)
  })

  it('reports degraded with 503 when the DB check fails, regardless of memory', async () => {
    checkDb.mockResolvedValue(false)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
  })

  it('reports memory-pressure with 503 when RSS crosses the threshold (#1725 proposal 5)', async () => {
    usage.mockReturnValue({ ...baseMemory, rss: 1601 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('memory-pressure')
    expect(body.db).toBe(true)
  })

  it('stays ok at exactly the threshold — only strictly above it trips', async () => {
    usage.mockReturnValue({ ...baseMemory, rss: 1600 })

    const res = await GET()

    expect(res.status).toBe(200)
  })
})
