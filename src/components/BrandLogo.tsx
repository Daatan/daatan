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
}

/**
 * Renders the app logo. With no override it's the bundled asset via next/image
 * (byte-identical to the previous hardcoded <Image>); when an operator sets
 * APP_LOGO_URL it's a plain <img> so any external URL works without next/image
 * remote-pattern config. Alt text is the app name.
 */
export function BrandLogo({ fallbackSrc, width, height, className, priority }: Props) {
  const { appName, logoUrl } = useBranding()

  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={appName} width={width} height={height} className={className} />
  }

  return <Image src={fallbackSrc} alt={appName} width={width} height={height} className={className} priority={priority} />
}
