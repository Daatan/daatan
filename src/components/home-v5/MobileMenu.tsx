'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Menu, Search, X } from 'lucide-react'
import type { HomeLinks } from './links'

interface Props {
  links: HomeLinks
  signedIn: boolean
  items: { href: string; label: string }[]
  labels: Record<
    'menu' | 'close' | 'search' | 'searchPlaceholder' | 'nav' | 'create' | 'login' | 'profile' | 'contact' | 'privacy' | 'terms' | 'home',
    string
  >
}

export default function MobileMenu({ links, items, signedIn, labels }: Props) {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        openerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    openerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-expanded={open}
        aria-controls="hv5-mobile-menu"
        aria-label={labels.menu}
        onClick={() => setOpen(true)}
        className="flex h-11 w-11 items-center justify-center text-[var(--hv5-ink)]"
      >
        <Menu className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="hv5-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label={labels.menu}
          className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[var(--hv5-bg)] text-[var(--hv5-ink)]"
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--hv5-line)] ps-2 pe-5">
            <Link href={links.home} aria-label={labels.home} onClick={close} className="flex items-center">
              <Image src="/home-v5/logo.png" alt="" width={292} height={129} className="h-8 w-auto" />
            </Link>
            <button
              ref={closeRef}
              type="button"
              aria-label={labels.close}
              onClick={close}
              className="flex h-11 w-11 items-center justify-center text-[var(--hv5-ink)]"
            >
              <X className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <form action={links.forecasts} method="get" role="search" className="px-5 pt-5">
            <label htmlFor="hv5-menu-search" className="mb-2 block text-sm text-[var(--hv5-muted)]">
              {labels.search}
            </label>
            <div className="flex h-[52px] items-center gap-2.5 rounded-[10px] border border-[var(--hv5-line-2)] bg-[var(--hv5-panel)] px-3.5 text-[var(--hv5-muted)]">
              <Search className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <input
                id="hv5-menu-search"
                name="q"
                type="search"
                placeholder={labels.searchPlaceholder}
                className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-white outline-none placeholder:text-[var(--hv5-muted)]"
              />
            </div>
          </form>
          <nav aria-label={labels.nav} className="flex flex-col px-5 pt-3">
            {items.map((i) => (
              <Link
                key={i.href + i.label}
                href={i.href}
                onClick={() => setOpen(false)}
                className="flex min-h-[60px] items-center justify-between border-b border-[var(--hv5-line)] text-[22px] font-bold text-white no-underline"
              >
                <span>{i.label}</span>
                <ChevronRight className="h-[18px] w-[18px] text-[var(--hv5-accent)] rtl:rotate-180" strokeWidth={2} aria-hidden="true" />
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3 px-5 pb-7 pt-6">
            <Link
              href={links.create}
              className="flex h-[54px] items-center justify-center rounded-lg bg-[var(--hv5-accent)] text-lg font-bold text-white no-underline"
            >
              {labels.create}
            </Link>
            <Link
              href={signedIn ? links.profile : links.login}
              className="flex h-[54px] items-center justify-center rounded-lg border border-[var(--hv5-accent-2)] text-lg font-bold text-[#dce8f7] no-underline"
            >
              {signedIn ? labels.profile : labels.login}
            </Link>
            <div className="mt-2.5 flex justify-center gap-7 text-[15px] text-[var(--hv5-muted)]">
              <Link href={links.contact} className="py-1.5 text-[var(--hv5-muted)]">{labels.contact}</Link>
              <Link href={links.privacy} className="py-1.5 text-[var(--hv5-muted)]">{labels.privacy}</Link>
              <Link href={links.terms} className="py-1.5 text-[var(--hv5-muted)]">{labels.terms}</Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
