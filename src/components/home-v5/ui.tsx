import Link from 'next/link'
import type { ReactNode } from 'react'

const BASE =
  'inline-flex h-[54px] items-center justify-center whitespace-nowrap rounded-lg px-7 text-lg font-bold no-underline transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

export function PrimaryButton({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`${BASE} bg-(--hv5-accent) text-white hover:bg-[#4a8bd6] ${className}`}>
      {children}
    </Link>
  )
}

export function OutlineButton({
  href,
  children,
  light = false,
  className = '',
}: {
  href: string
  children: ReactNode
  light?: boolean
  className?: string
}) {
  const tone = light
    ? 'border border-(--hv5-accent) text-(--hv5-accent) hover:bg-(--hv5-light-icon-bg)'
    : 'border border-(--hv5-accent-2) text-[#dce8f7] hover:bg-white/5'
  return (
    <Link href={href} className={`${BASE} ${tone} ${className}`}>
      {children}
    </Link>
  )
}

export const CONTAINER = 'mx-auto w-full max-w-[1240px] px-5 md:px-12'
