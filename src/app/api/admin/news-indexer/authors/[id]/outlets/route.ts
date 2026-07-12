import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** POST /api/admin/news-indexer/authors/[id]/outlets — link a person to an outlet
 *  (their own channel, or an outlet they write for). Auto-vivifies the outlet row
 *  by name if it doesn't exist yet. */
export const POST = withAuth(
  async (request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid request body', 400)

    log.info({ userId: user.id, personId: params.id }, 'linking news-indexer outlet')
    return proxyAuthorsAdmin(`/authors/${params.id}/outlets`, { method: 'POST', body })
  },
  { roles: ['ADMIN'] },
)
