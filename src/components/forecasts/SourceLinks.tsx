import { Fragment } from 'react'
import Link from 'next/link'
import { articleHost, sourcePagePath } from '@/lib/utils/source-page'

export type SourceLink = { name: string; href: string | null }

type SnapshotSource = { sourceName?: string | null; url: string; settled?: boolean | null }

/**
 * The sources that reported the outcome as already decided, the ones behind a settlement pin
 * (#1250). Each is named by its `sourceName`, else its URL host, and linked to its
 * /sources page by host (#2298); a display name like "RFE/RL" is not a page key.
 */
export function settlingSources(oracle: { sources?: SnapshotSource[] } | null | undefined): SourceLink[] {
  return (oracle?.sources ?? [])
    .filter((s) => s.settled === true)
    .map((s) => ({ name: s.sourceName || articleHost(s.url) || s.url, href: sourcePagePath(null, s.url) }))
}

/** Comma-separated source names, each linked to its /sources page when it has one. */
export function SourceLinks({ sources }: { sources: SourceLink[] }) {
  return (
    <>
      {sources.map((s, i) => (
        <Fragment key={`${i}-${s.name}`}>
          {i > 0 && ', '}
          {s.href ? (
            <Link href={s.href} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
              {s.name}
            </Link>
          ) : (
            s.name
          )}
        </Fragment>
      ))}
    </>
  )
}
