import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { notifyIndexNowBulk } from '@/lib/services/indexnow'
import sitemap from '@/app/sitemap'

export const dynamic = 'force-dynamic'

// POST /api/admin/indexnow/resubmit
// Bulk-submits every indexable URL to IndexNow (Bing/Yandex/Seznam). The
// per-event notify only covers forecasts changed since that feature shipped;
// this pushes the whole backlog (and is safe to re-run after large backfills).
// URLs come straight from the sitemap, so the submission can never drift from
// what we tell crawlers is indexable. No-op without INDEXNOW_KEY; the sitemap
// is empty off-production, so this only does real work on prod.
export const POST = withAuth(async () => {
  try {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    const result = await notifyIndexNowBulk(urls)
    return NextResponse.json({ success: true, discovered: urls.length, ...result })
  } catch (err) {
    return handleRouteError(err, 'Failed to resubmit URLs to IndexNow')
  }
}, { roles: ['ADMIN'] })
