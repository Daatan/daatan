import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { consentScript, GEO_TIMEOUT_MS } from '../consent-region'

type Call = unknown[]

function runScript() {
  new Function(consentScript())()
  return window.__daatanConsentNotRequired
}

function calls(): Call[] {
  return (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
}

const granted = (c: Call) => c[0] === 'consent' && c[1] === 'update' && (c[2] as { analytics_storage?: string }).analytics_storage === 'granted'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)
}

describe('consentScript', () => {
  beforeEach(() => {
    localStorage.clear()
    window.dataLayer = []
    delete window.__daatanConsentNotRequired
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('defaults to denied and waits for the region check', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    runScript()
    expect(calls()[0]).toEqual(['consent', 'default', expect.objectContaining({ analytics_storage: 'denied', wait_for_update: GEO_TIMEOUT_MS })])
  })

  it('grants analytics only on a literal consentRequired:false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ consentRequired: false })))
    expect(await runScript()).toBe(true)
    expect(calls().some(granted)).toBe(true)
  })

  it.each([
    ['consentRequired:true', { consentRequired: true }],
    ['the string "false"', { consentRequired: 'false' }],
    ['an empty object', {}],
    ['null', null],
  ])('stays denied on %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(body)))
    expect(await runScript()).toBe(false)
    expect(calls().some(granted)).toBe(false)
  })

  it('stays denied on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ consentRequired: false }, false)))
    expect(await runScript()).toBe(false)
    expect(calls().some(granted)).toBe(false)
  })

  it('stays denied when the fetch rejects (network error, CSP block)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('blocked'))))
    expect(await runScript()).toBe(false)
    expect(calls().some(granted)).toBe(false)
  })

  it('stays denied when the region check times out, even if it answers later', async () => {
    vi.useFakeTimers()
    let answer: (v: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r })))
    const p = runScript()
    await vi.advanceTimersByTimeAsync(GEO_TIMEOUT_MS + 1)
    answer({ ok: true, json: () => Promise.resolve({ consentRequired: false }) } as Response)
    expect(await p).toBe(false)
    expect(calls().some(granted)).toBe(false)
  })

  it('does not grant if the visitor declined while the check was in flight', async () => {
    let answer: (v: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r })))
    const p = runScript()
    localStorage.setItem('daatan_analytics_consent', 'denied')
    answer({ ok: true, json: () => Promise.resolve({ consentRequired: false }) } as Response)
    await p
    expect(calls().some(granted)).toBe(false)
  })

  it.each(['granted', 'denied'])('skips the region check when %s is stored', (stored) => {
    localStorage.setItem('daatan_analytics_consent', stored)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(runScript()).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls()[0]).toEqual(['consent', 'default', expect.objectContaining({ analytics_storage: stored, wait_for_update: undefined })])
  })
})
