import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandLogo } from '@/components/BrandLogo'
import { BrandingProvider } from '@/components/BrandingProvider'

describe('BrandLogo', () => {
  it('renders the operator logo override with the app name as alt', () => {
    render(
      <BrandingProvider value={{ appName: 'Acme Forecasting', logoUrl: 'https://cdn.example/logo.png' }}>
        <BrandLogo fallbackSrc="/logo-icon.svg" width={40} height={40} />
      </BrandingProvider>,
    )
    const img = screen.getByAltText('Acme Forecasting') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example/logo.png')
  })

  it('falls back to the bundled asset and DAATAN alt with no provider/override', () => {
    render(<BrandLogo fallbackSrc="/logo-icon.svg" width={40} height={40} />)
    // next/image rewrites src, so assert via alt (the default app name) and that
    // the override URL is NOT used.
    const img = screen.getByAltText('DAATAN') as HTMLImageElement
    expect(img.getAttribute('src')).not.toBe('https://cdn.example/logo.png')
  })
})
