import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar } from '../Avatar'
import { toAvatarSrc } from '@/lib/avatar-src'
import { BrandingProvider } from '../BrandingProvider'

describe('Avatar Component', () => {
  describe('initials generation', () => {
    it('renders two-letter initials from first and last name', () => {
      render(<Avatar src={null} name="John Doe" size={32} />)
      expect(screen.getByText('JD')).toBeInTheDocument()
    })

    it('renders two-letter initials from multi-word name (first + last)', () => {
      render(<Avatar src={null} name="Mary Jane Watson" size={32} />)
      expect(screen.getByText('MW')).toBeInTheDocument()
    })

    it('renders single initial for single-word name', () => {
      render(<Avatar src={null} name="Alice" size={32} />)
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('renders ? when name is null', () => {
      render(<Avatar src={null} name={null} size={32} />)
      expect(screen.getByText('?')).toBeInTheDocument()
    })

    it('renders ? when name is undefined', () => {
      render(<Avatar src={null} name={undefined} size={32} />)
      expect(screen.getByText('?')).toBeInTheDocument()
    })

    it('uppercases initials regardless of input case', () => {
      render(<Avatar src={null} name="john doe" size={32} />)
      expect(screen.getByText('JD')).toBeInTheDocument()
    })
  })

  describe('fallback avatar rendering', () => {
    it('renders a coloured circle when src is null', () => {
      const { container } = render(<Avatar src={null} name="Test User" size={40} />)
      const div = container.firstChild as HTMLElement
      expect(div).toHaveStyle({ width: '40px', height: '40px' })
      expect(div).toHaveClass('rounded-full')
    })

    it('applies custom className', () => {
      const { container } = render(
        <Avatar src={null} name="Test" size={32} className="ring-2" />
      )
      const div = container.firstChild as HTMLElement
      expect(div).toHaveClass('ring-2')
    })
  })

  describe('deterministic color', () => {
    it('produces the same color for the same name across renders', () => {
      const { container: first } = render(<Avatar src={null} name="Stable" size={32} />)
      const { container: second } = render(<Avatar src={null} name="Stable" size={32} />)
      const firstClasses = (first.firstChild as HTMLElement).className
      const secondClasses = (second.firstChild as HTMLElement).className
      expect(firstClasses).toBe(secondClasses)
    })

    it('may produce different colors for different names', () => {
      const { container: a } = render(<Avatar src={null} name="AAAA" size={32} />)
      const { container: z } = render(<Avatar src={null} name="ZZZZ" size={32} />)
      const aClasses = (a.firstChild as HTMLElement).className
      const zClasses = (z.firstChild as HTMLElement).className
      expect(aClasses).toBeTruthy()
      expect(zClasses).toBeTruthy()
    })
  })

  describe('image rendering', () => {
    it('renders an img element when src is provided', () => {
      render(<Avatar src="/photo.jpg" name="Photo User" size={48} />)
      const img = screen.getByAltText('Photo User')
      expect(img).toBeInTheDocument()
    })

    // #2362: /_next/image answers 400 for an absolute URL whose host is not in remotePatterns,
    // which is how the Daatan account's avatar is stored.
    const optimizedUrl = (alt: string) => new URL(screen.getByAltText(alt).getAttribute('src')!, 'http://x').searchParams.get('url')

    it('serves an avatar on this site by path, so the optimizer accepts it', () => {
      render(<Avatar src="https://daatan.com/logo-icon-192.png" name="Daatan" size={32} />)
      expect(optimizedUrl('Daatan')).toBe('/logo-icon-192.png')
    })

    it('uses the app URL from branding, as on a self-hosted instance', () => {
      render(
        <BrandingProvider value={{ appName: 'Forecasting', logoUrl: null, appUrl: 'https://forecasts.example.org' }}>
          <Avatar src="https://forecasts.example.org/logo-icon-192.png" name="Daatan" size={32} />
        </BrandingProvider>,
      )
      expect(optimizedUrl('Daatan')).toBe('/logo-icon-192.png')
    })

    it('leaves a Google avatar absolute', () => {
      render(<Avatar src="https://lh3.googleusercontent.com/a/abc=s96-c" name="Google User" size={32} />)
      expect(optimizedUrl('Google User')).toBe('https://lh3.googleusercontent.com/a/abc=s96-c')
    })
  })

  describe('toAvatarSrc', () => {
    it('strips only this site\'s own origin', () => {
      expect(toAvatarSrc('https://daatan.com/a.png', 'https://daatan.com')).toBe('/a.png')
      expect(toAvatarSrc('https://daatan.com.evil.test/a.png', 'https://daatan.com')).toBe('https://daatan.com.evil.test/a.png')
      expect(toAvatarSrc('https://staging.daatan.com/a.png', 'https://daatan.com')).toBe('https://staging.daatan.com/a.png')
      expect(toAvatarSrc('/api/uploads/avatars/u/x.webp', 'https://daatan.com')).toBe('/api/uploads/avatars/u/x.webp')
    })
  })
})
