'use client'

import Image from 'next/image'
import { useBranding } from '@/components/BrandingProvider'

type Props = {
  /** Bundled asset used when no APP_LOGO_URL override is set (the SaaS path). */
  fallbackSrc: string
  width: number
  height: number
  className?: string
  priority?: boolean
  /**
   * Pass "" when the logo sits next to visible text that already names the app
   * (e.g. a `{appName}` span) — otherwise screen readers announce the name twice.
   * Defaults to the app name, for standalone usages (sign-in/sign-up pages).
   */
  alt?: string
}

/**
 * Renders the app logo. With no override it's the bundled asset via next/image
 * (byte-identical to the previous hardcoded <Image>); when an operator sets
 * APP_LOGO_URL it's a plain <img> so any external URL works without next/image
 * remote-pattern config.
 */
export function BrandLogo({ fallbackSrc, width, height, className, priority, alt }: Props) {
  const { appName, logoUrl } = useBranding()
  const resolvedAlt = alt ?? appName

  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={resolvedAlt} width={width} height={height} className={className} />
  }

  return <Image src={fallbackSrc} alt={resolvedAlt} width={width} height={height} className={className} priority={priority} />
}
