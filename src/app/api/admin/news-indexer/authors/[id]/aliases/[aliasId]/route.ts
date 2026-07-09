import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** DELETE /api/admin/news-indexer/authors/[id]/aliases/[aliasId] — remove one alias. */
export const DELETE = withAuth(
  async (_request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)
    if (!isUuid(params.aliasId)) return apiError('Invalid alias id', 400)

    log.info({ userId: user.id, personId: params.id, aliasId: params.aliasId }, 'deleting news-indexer alias')
    return proxyAuthorsAdmin(`/authors/${params.id}/aliases/${params.aliasId}`, { method: 'DELETE' })
  },
  { roles: ['ADMIN'] },
)
