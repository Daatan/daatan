import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** `base` for page 1 (its canonical has no param), `base?page=N` otherwise. */
export function pageHref(base: string, page: number): string {
  return page <= 1 ? base : `${base}?page=${page}`
}

/** Clamp a raw `?page=` value to a positive integer (anything unparseable is page 1). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const n = Math.floor(Number(Array.isArray(raw) ? raw[0] : raw))
  return Number.isFinite(n) && n > 1 ? n : 1
}

const LINK =
  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-navy-700 text-text-secondary hover:bg-navy-600 transition-colors'

/**
 * Real `<a href>` prev/next links, server-rendered, so crawlers can walk a paginated list
 * (daatan#2027). Renders nothing for a single page.
 */
export default function PaginationLinks({
  base,
  page,
  totalPages,
  labels,
}: {
  base: string
  page: number
  totalPages: number
  labels: { previous: string; next: string; status: string }
}) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label={labels.status} className="flex items-center justify-center gap-4 mt-8">
      {page > 1 && (
        <Link href={pageHref(base, page - 1)} rel="prev" className={LINK}>
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
          {labels.previous}
        </Link>
      )}
      <span className="text-sm text-gray-500">{labels.status}</span>
      {page < totalPages && (
        <Link href={pageHref(base, page + 1)} rel="next" className={LINK}>
          {labels.next}
          <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      )}
    </nav>
  )
}
