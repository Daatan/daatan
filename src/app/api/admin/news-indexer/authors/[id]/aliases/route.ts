import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** POST /api/admin/news-indexer/authors/[id]/aliases — add a byline or channel-name alias. */
export const POST = withAuth(
  async (request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid request body', 400)

    log.info({ userId: user.id, personId: params.id }, 'adding news-indexer alias')
    return proxyAuthorsAdmin(`/authors/${params.id}/aliases`, { method: 'POST', body })
  },
  { roles: ['ADMIN'] },
)
