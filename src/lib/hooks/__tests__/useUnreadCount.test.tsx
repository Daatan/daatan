import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useUnreadCount, notifyUnreadCountChanged } from '../useUnreadCount'

describe('useUnreadCount', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ count: 71 }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the count on mount', async () => {
    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(71))
  })

  it('updates immediately when notifyUnreadCountChanged(0) fires (mark all read)', async () => {
    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(71))

    act(() => notifyUnreadCountChanged(0))
    expect(result.current.count).toBe(0)
  })

  it('refetches when notifyUnreadCountChanged() fires without a count', async () => {
    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(71))

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ count: 70 }) })
    act(() => notifyUnreadCountChanged())
    await waitFor(() => expect(result.current.count).toBe(70))
  })
})
