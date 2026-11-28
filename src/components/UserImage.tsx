'use client'

import Image, { type ImageProps } from 'next/image'
import { useBranding } from '@/components/BrandingProvider'
import { toAvatarSrc } from '@/lib/avatar-src'

/** next/image for a user's stored avatar URL. Render user avatars through this, not `Image` (#2362). */
export function UserImage({ src, alt, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  const { appUrl } = useBranding()
  return <Image src={toAvatarSrc(src, appUrl)} alt={alt} {...props} />
}
