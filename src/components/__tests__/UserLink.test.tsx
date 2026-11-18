import { render, screen } from '@testing-library/react'
import { UserLink } from '../UserLink'
import { describe, it, expect, vi } from 'vitest'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, onClick, className, ...rest }: any) => (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  ),
}))

// Mock Avatar component
vi.mock('../Avatar', () => ({
  Avatar: ({ name, size }: any) => (
    <div data-testid="mock-avatar" data-name={name} data-size={size}>
      Avatar
    </div>
  ),
}))

describe('UserLink Component', () => {
  const mockUser = {
    userId: 'user-123',
    username: 'jdoe',
    name: 'John Doe',
    image: 'https://example.com/avatar.jpg',
  }

  it('renders name correctly', () => {
    render(<UserLink {...mockUser} />)
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })

  it('renders username when name is missing', () => {
    render(<UserLink userId="user-123" username="jdoe" />)
    expect(screen.getByText('@jdoe')).toBeInTheDocument()
  })

  it('renders Anonymous when both name and username are missing', () => {
    render(<UserLink userId="user-123" />)
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
  })

  it('renders avatar when showAvatar is true', () => {
    render(<UserLink {...mockUser} showAvatar={true} avatarSize={40} />)
    const avatar = screen.getByTestId('mock-avatar')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveAttribute('data-name', 'John Doe')
    expect(avatar).toHaveAttribute('data-size', '40')
  })

  it('links to the correct profile URL', () => {
    render(<UserLink {...mockUser} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/profile/user-123')
  })

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<UserLink {...mockUser} onClick={handleClick} />)
    screen.getByRole('link').click()
    expect(handleClick).toHaveBeenCalled()
  })

  it('renders children if provided instead of name/username', () => {
    render(
      <UserLink {...mockUser}>
        <span data-testid="custom-child">Custom Content</span>
      </UserLink>
    )
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.getByTestId('custom-child')).toHaveTextContent('Custom Content')
  })

  it('showName={false} renders the avatar only, with the name as the link label', () => {
    render(<UserLink {...mockUser} showAvatar showName={false} />)
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-avatar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'John Doe' })).toHaveAttribute('href', '/profile/user-123')
  })

  it('shows the name and sets no aria-label by default', () => {
    render(<UserLink {...mockUser} />)
    expect(screen.getByRole('link')).not.toHaveAttribute('aria-label')
  })
})
