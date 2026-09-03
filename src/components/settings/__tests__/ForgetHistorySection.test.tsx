import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import ForgetHistorySection from '../ForgetHistorySection'
import messages from '../../../../messages/en.json'

const renderWithIntl = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ForgetHistorySection />
    </NextIntlClientProvider>
  )

const mockFetch = vi.fn()
const mockRefresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('react-hot-toast', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = mockFetch
})

describe('ForgetHistorySection', () => {
  it('shows a confirmation step before calling the API', () => {
    renderWithIntl()

    expect(screen.getByText('Forget my history')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Forget my history'))

    expect(screen.getByText(/permanently detached/)).toBeInTheDocument()
  })

  it('calls the forget-history endpoint and shows success on confirm', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 })
    renderWithIntl()

    fireEvent.click(screen.getByText('Forget my history'))
    fireEvent.click(screen.getByText('Yes, forget my history'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/account/forget-history', { method: 'POST' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('History forgotten'))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the blocked message on a 400 without refreshing', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 })
    renderWithIntl()

    fireEvent.click(screen.getByText('Forget my history'))
    fireEvent.click(screen.getByText('Yes, forget my history'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/active or pending/)))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
