import { render, screen, fireEvent } from '@testing-library/react'
import { axe } from 'jest-axe'
import Sidebar from '../Sidebar'
import { useSession } from 'next-auth/react'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/i18n/routing', () => ({
  Link: ({ children, href, onClick }: any) => <a href={href} onClick={onClick}>{children}</a>,
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  })
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'signIn') return 'Sign In'
    return key
  },
  useLocale: () => 'en'
}))

describe('Sidebar Component', () => {
  it('renders sign in button when unauthenticated', () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)

    render(<Sidebar />)
    // Use getAllByText since "Sign In" appears in both desktop and mobile views
    const signInButtons = screen.getAllByText(/Sign In/i)
    expect(signInButtons.length).toBeGreaterThan(0)
  })

  it('renders user info when authenticated', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com', image: null },
        expires: 'any',
      },
      status: 'authenticated',
    } as any)

    render(<Sidebar />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays username instead of name when username is available', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: {
          name: 'Admin User',
          username: 'admin_nick',
          email: 'admin@example.com',
          image: null,
          role: 'ADMIN',
        },
        expires: 'any',
      },
      status: 'authenticated',
    } as any)

    render(<Sidebar />)
    expect(screen.getByText('admin_nick')).toBeInTheDocument()
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument()
  })

  it('falls back to name when username is null', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: {
          name: 'Fallback Name',
          username: null,
          email: 'user@example.com',
          image: null,
        },
        expires: 'any',
      },
      status: 'authenticated',
    } as any)

    render(<Sidebar />)
    expect(screen.getByText('Fallback Name')).toBeInTheDocument()
  })

  it('opens an inline header search (not the nav drawer) when the mobile search icon is tapped', () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)

    render(<Sidebar />)

    // No inline search field before tapping the icon.
    expect(screen.queryByPlaceholderText('searchPlaceholder')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('search'))

    // The header morphs into an inline search field with a back affordance…
    expect(screen.getByPlaceholderText('searchPlaceholder')).toBeInTheDocument()
    expect(screen.getByLabelText('back')).toBeInTheDocument()
    // …and the left nav drawer was NOT opened (no close-menu overlay).
    expect(screen.queryByLabelText('Close menu')).not.toBeInTheDocument()
  })

  it('handles null session data gracefully (Build-time scenario)', () => {
    // This mocks the scenario that crashed the build: useSession returning undefined
    vi.mocked(useSession).mockReturnValue(undefined as any)

    // Component should not throw error even if session hook fails
    const { container } = render(<Sidebar />)
    expect(container).toBeInTheDocument()
  })

  it('has no automatically detectable a11y violations', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)

    const { container } = render(<Sidebar />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
