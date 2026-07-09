import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/env', () => ({
  env: { NEWS_INDEXER_URL: 'https://scrapper.test', NEWS_INDEXER_API_KEY: 'test-key' },
}))

import { env } from '@/env'
import { isUuid, proxyAuthorsAdmin } from '../news-indexer-authors'

const UUID = 'd1a8046c-b8a1-4a41-b12e-7ddd89ef275c'

const mockEnv = env as unknown as { NEWS_INDEXER_URL?: string; NEWS_INDEXER_API_KEY?: string }

describe('isUuid', () => {
  it('accepts the upstream person/alias id shape', () => {
    expect(isUuid(UUID)).toBe(true)
    expect(isUuid(UUID.toUpperCase())).toBe(true)
  })

  it('rejects path traversal and other non-uuid segments', () => {
    expect(isUuid('..')).toBe(false)
    expect(isUuid('admin/people')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(`${UUID}/../ledger`)).toBe(false)
  })
})

describe('proxyAuthorsAdmin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockEnv.NEWS_INDEXER_URL = 'https://scrapper.test'
    mockEnv.NEWS_INDEXER_API_KEY = 'test-key'
  })

  it('attaches the api key server-side and never returns it to the caller', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ people: [] }), { status: 200 }),
    )

    const res = await proxyAuthorsAdmin('/authors/admin/people')
    const body = await res.text()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://scrapper.test/authors/admin/people')
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key')
    expect(body).not.toContain('test-key')
    expect(res.status).toBe(200)
  })

  it('sends a json body only when one is supplied', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await proxyAuthorsAdmin(`/authors/${UUID}`, { method: 'DELETE' })
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body')

    await proxyAuthorsAdmin('/authors', { method: 'POST', body: { canonical_name: 'Ben Caspit' } })
    const init = fetchMock.mock.calls[1][1]!
    expect(init.body).toBe('{"canonical_name":"Ben Caspit"}')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it("translates FastAPI's {detail} into the {error} shape and preserves the status", async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'a person with this name already exists' }), { status: 409 }),
    )

    const res = await proxyAuthorsAdmin('/authors', { method: 'POST', body: {} })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'a person with this name already exists' })
  })

  it('collapses a 422 validation array into a single message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: [{ loc: ['body'], msg: 'field required' }] }), { status: 422 }),
    )

    const res = await proxyAuthorsAdmin('/authors', { method: 'POST', body: {} })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid request' })
  })

  it('reports 503 when news-indexer is not configured', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')
    mockEnv.NEWS_INDEXER_API_KEY = undefined

    const res = await proxyAuthorsAdmin('/authors/admin/people')
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
