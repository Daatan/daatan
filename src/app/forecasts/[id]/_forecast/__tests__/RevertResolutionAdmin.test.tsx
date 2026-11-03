import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { toast } from 'react-hot-toast'
import { RevertResolutionAdmin } from '../RevertResolutionAdmin'
import type { Prediction } from '../types'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const resolved = { id: 'pred-1', status: 'RESOLVED_WRONG' } as unknown as Prediction

const signedInAs = (role: string) =>
  vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u1', role } }, status: 'authenticated' } as never)

function openWithReason(reason: string) {
  fireEvent.click(screen.getByRole('button', { name: /revert resolution/i }))
  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: reason } })
}

const confirmButton = () => screen.getByRole('button', { name: /confirm revert/i }) as HTMLButtonElement

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })
beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('ADMIN')
})

describe('RevertResolutionAdmin', () => {
  it.each(['RESOLVER', 'APPROVER', 'USER'])('renders nothing for %s', (role) => {
    signedInAs(role)
    const { container } = render(<RevertResolutionAdmin prediction={resolved} onReverted={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['ACTIVE', 'PENDING', 'DRAFT', 'PENDING_APPROVAL'])('renders nothing on a %s forecast', (status) => {
    const p = { id: 'pred-1', status } as unknown as Prediction
    const { container } = render(<RevertResolutionAdmin prediction={p} onReverted={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE'])('offers the revert on %s', (status) => {
    const p = { id: 'pred-1', status } as unknown as Prediction
    render(<RevertResolutionAdmin prediction={p} onReverted={vi.fn()} />)
    expect(screen.getByRole('button', { name: /revert resolution/i })).toBeInTheDocument()
  })

  it('needs a non-blank reason before it can be confirmed', () => {
    render(<RevertResolutionAdmin prediction={resolved} onReverted={vi.fn()} />)

    openWithReason('   ')
    expect(confirmButton().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'too early' } })
    expect(confirmButton().disabled).toBe(false)
  })

  it('sends nothing until confirmed, and cancel backs out', () => {
    global.fetch = vi.fn()
    render(<RevertResolutionAdmin prediction={resolved} onReverted={vi.fn()} />)

    openWithReason('too early')
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /revert resolution/i })).toBeInTheDocument()
  })

  it('posts the trimmed reason, then lets the parent reload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    const onReverted = vi.fn()
    render(<RevertResolutionAdmin prediction={resolved} onReverted={onReverted} />)

    openWithReason('  too early ')
    await act(async () => { fireEvent.click(confirmButton()) })

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/forecasts/pred-1/unresolve', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'too early' }),
    }))
    expect(onReverted).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shows a refusal as the server wrote it and does not reload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'A later resolution (forecast abc) touched the same users. Revert it first' }),
    })
    const onReverted = vi.fn()
    render(<RevertResolutionAdmin prediction={resolved} onReverted={onReverted} />)

    openWithReason('too early')
    await act(async () => { fireEvent.click(confirmButton()) })

    expect(toast.error).toHaveBeenCalledWith('A later resolution (forecast abc) touched the same users. Revert it first')
    expect(onReverted).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
