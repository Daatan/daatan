import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { SettledLatchAdmin } from '../SettledLatchAdmin'
import type { Prediction } from '../types'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const prediction = { id: 'pred-1', settled: true } as unknown as Prediction

const asAdmin = () =>
  vi.mocked(useSession).mockReturnValue({
    data: { user: { id: 'u1', role: 'ADMIN' } }, status: 'authenticated',
  } as never)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })
beforeEach(() => { vi.clearAllMocks() })

describe('SettledLatchAdmin', () => {
  it('renders nothing for non-admins', () => {
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1', role: 'USER' } }, status: 'authenticated',
    } as never)
    const { container } = render(<SettledLatchAdmin prediction={prediction} onCleared={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the forecast is not settled', () => {
    asAdmin()
    const notSettled = { id: 'pred-1', settled: false } as unknown as Prediction
    const { container } = render(<SettledLatchAdmin prediction={notSettled} onCleared={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onCleared after a successful clear, so the parent can drop settled from its state', async () => {
    asAdmin()
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    const onCleared = vi.fn()
    render(<SettledLatchAdmin prediction={prediction} onCleared={onCleared} />)

    await act(async () => {
      screen.getByRole('button', { name: /clear settlement/i }).click()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/forecasts/pred-1/settled', { method: 'DELETE' })
    expect(onCleared).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not call onCleared when the clear fails', async () => {
    asAdmin()
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const onCleared = vi.fn()
    render(<SettledLatchAdmin prediction={prediction} onCleared={onCleared} />)

    await act(async () => {
      screen.getByRole('button', { name: /clear settlement/i }).click()
    })

    expect(onCleared).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
