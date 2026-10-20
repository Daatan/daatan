import { withAuth } from '@/lib/api-middleware'
import { createLogger } from '@/lib/logger'
import { parseJsonBody } from '@/lib/api-body'
import { forwardedObjectBodySchema } from '@/lib/validations/api-inputs'
import { proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'


const log = createLogger('admin-news-indexer-authors')

/** GET /api/admin/news-indexer/authors — every curated person with their alias rows. */
export const GET = withAuth(
  async () => proxyAuthorsAdmin('/authors/admin/people'),
  { roles: ['ADMIN'] },
)

/** POST /api/admin/news-indexer/authors — create a curated person. */
export const POST = withAuth(
  async (request, user) => {
    const body = await parseJsonBody(request, forwardedObjectBodySchema)

    // Upstream's audit trail is a log line with no user identity — it authenticates
    // callers by one shared key. Record who actually made the change on this side.
    log.info({ userId: user.id }, 'creating news-indexer person')
    return proxyAuthorsAdmin('/authors', { method: 'POST', body })
  },
  { roles: ['ADMIN'] },
)
