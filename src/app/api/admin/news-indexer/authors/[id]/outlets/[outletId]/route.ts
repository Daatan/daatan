import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** DELETE /api/admin/news-indexer/authors/[id]/outlets/[outletId] — remove one person<->outlet link. */
export const DELETE = withAuth(
  async (_request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)
    if (!isUuid(params.outletId)) return apiError('Invalid outlet id', 400)

    log.info({ userId: user.id, personId: params.id, outletId: params.outletId }, 'unlinking news-indexer outlet')
    return proxyAuthorsAdmin(`/authors/${params.id}/outlets/${params.outletId}`, { method: 'DELETE' })
  },
  { roles: ['ADMIN'] },
)
