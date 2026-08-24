/* eslint-disable jsx-a11y/aria-role -- `role` here is RoleBadge's own prop (a UserRole), not an ARIA role attribute */
import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, it, expect } from 'vitest'
import { RoleBadge } from '../RoleBadge'

describe('RoleBadge', () => {
  it('renders nothing for USER or undefined role', () => {
    const { container: userContainer } = render(<RoleBadge role="USER" />)
    expect(userContainer).toBeEmptyDOMElement()

    const { container: undefinedContainer } = render(<RoleBadge role={undefined} />)
    expect(undefinedContainer).toBeEmptyDOMElement()
  })

  it('renders compact "A" badge for ADMIN role', () => {
    render(<RoleBadge role="ADMIN" />)

    const badge = screen.getByText('A')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Admin')
    expect(badge).toHaveAttribute('aria-label', 'Admin')
    expect(badge).toHaveAttribute('role', 'img')
    expect(badge.className).toContain('text-red-700')
  })

  it('renders compact "R" badge for RESOLVER role', () => {
    render(<RoleBadge role="RESOLVER" />)

    const badge = screen.getByText('R')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Resolver')
    expect(badge).toHaveAttribute('aria-label', 'Resolver')
    expect(badge.className).toContain('text-blue-800')
  })

  it('applies size variants', () => {
    const { rerender } = render(<RoleBadge role="ADMIN" size="sm" />)
    const small = screen.getByText('A')
    expect(small.className).toContain('w-4')
    expect(small.className).toContain('text-[9px]')

    rerender(<RoleBadge role="ADMIN" size="md" />)
    const medium = screen.getByText('A')
    expect(medium.className).toContain('w-5')
    expect(medium.className).toContain('text-[11px]')
  })

  it('has no automatically detectable a11y violations', async () => {
    const { container } = render(<RoleBadge role="ADMIN" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

