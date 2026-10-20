import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getBotRunJob, startBotRunJob, resetBotRunJobsForTest } from '../runJobs'
import type { BotRunSummary } from '../runner'

const summary = { botName: 'b', forecastsCreated: 1 } as unknown as BotRunSummary

describe('bot run jobs (#1947)', () => {
  beforeEach(() => resetBotRunJobsForTest())

  it('reports running, then done with the summary', async () => {
    let finish!: (s: BotRunSummary) => void
    const run = vi.fn(() => new Promise<BotRunSummary>((r) => { finish = r }))

    expect(startBotRunJob('a', true, run)).toBe(true)
    expect(getBotRunJob('a')?.status).toBe('running')

    finish(summary)
    await vi.waitFor(() => expect(getBotRunJob('a')?.status).toBe('done'))
    expect(getBotRunJob('a')).toMatchObject({ dryRun: true, summary })
  })

  it('joins a run already in flight instead of starting a second one', () => {
    const run = vi.fn(() => new Promise<BotRunSummary>(() => {}))

    expect(startBotRunJob('a', false, run)).toBe(true)
    expect(startBotRunJob('a', false, run)).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('records a failure message and allows a new run afterwards', async () => {
    startBotRunJob('a', false, () => Promise.reject(new Error('boom')))
    await vi.waitFor(() => expect(getBotRunJob('a')?.status).toBe('failed'))
    expect(getBotRunJob('a')).toMatchObject({ error: 'boom' })

    expect(startBotRunJob('a', false, () => Promise.resolve(summary))).toBe(true)
  })

  it('forgets finished jobs after the TTL', async () => {
    startBotRunJob('a', false, () => Promise.resolve(summary))
    await vi.waitFor(() => expect(getBotRunJob('a')?.status).toBe('done'))

    expect(getBotRunJob('a', Date.now() + 11 * 60_000)).toBeUndefined()
    expect(getBotRunJob('a')).toBeUndefined()
  })

  it('keeps jobs of different bots independent', () => {
    const run = () => new Promise<BotRunSummary>(() => {})
    expect(startBotRunJob('a', false, run)).toBe(true)
    expect(startBotRunJob('b', false, run)).toBe(true)
  })
})
