import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useSession } from 'next-auth/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CommitmentsPage from '../page'
import messages from '../../../../messages/en.json'

const renderWithIntl = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CommitmentsPage />
    </NextIntlClientProvider>
  )

function mockCommitmentsResponse(predictionStatus: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      commitments: [
        {
          id: 'commitment-1',
          cuCommitted: 10,
          createdAt: new Date().toISOString(),
          prediction: {
            id: 'prediction-1',
            claimText: 'Test claim',
            status: predictionStatus,
            outcomeType: 'BINARY',
            resolvedAt: null,
            winningOptionId: null,
          },
        },
      ],
    }),
  }) as unknown as typeof fetch
}

describe('CommitmentsPage', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: 'any' },
      status: 'authenticated',
    } as any)
  })

  // Regression test for daatan#1184: the badge read `commitment.status`, a field
  // that doesn't exist on the Commitment model (status lives on the related
  // Prediction), so it always rendered the untranslated key literally.
  it('renders the prediction status as a translated label, not a raw i18n key', async () => {
    mockCommitmentsResponse('ACTIVE')

    renderWithIntl()

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
    expect(screen.queryByText(/status\.undefined/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status\.ACTIVE/)).not.toBeInTheDocument()
  })

  it('renders a translated label for a RESOLVED_CORRECT prediction', async () => {
    mockCommitmentsResponse('RESOLVED_CORRECT')

    renderWithIntl()

    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeInTheDocument()
    })
  })

  it('renders a translated label for a RESOLVED_WRONG prediction', async () => {
    mockCommitmentsResponse('RESOLVED_WRONG')

    renderWithIntl()

    await waitFor(() => {
      expect(screen.getByText('Wrong')).toBeInTheDocument()
    })
  })
})
