import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** GET /api/admin/news-indexer/authors — every curated person with their alias rows. */
export const GET = withAuth(
  async () => proxyAuthorsAdmin('/authors/admin/people'),
  { roles: ['ADMIN'] },
)

/** POST /api/admin/news-indexer/authors — create a curated person. */
export const POST = withAuth(
  async (request, user) => {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid request body', 400)

    // Upstream's audit trail is a log line with no user identity — it authenticates
    // callers by one shared key. Record who actually made the change on this side.
    log.info({ userId: user.id }, 'creating news-indexer person')
    return proxyAuthorsAdmin('/authors', { method: 'POST', body })
  },
  { roles: ['ADMIN'] },
)
