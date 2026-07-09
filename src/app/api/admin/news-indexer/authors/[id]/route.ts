import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'

export const dynamic = 'force-dynamic'

const log = createLogger('admin-news-indexer-authors')

/** PATCH /api/admin/news-indexer/authors/[id] — rename a person or edit their notes. */
export const PATCH = withAuth(
  async (request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid request body', 400)

    log.info({ userId: user.id, personId: params.id }, 'updating news-indexer person')
    return proxyAuthorsAdmin(`/authors/${params.id}`, { method: 'PATCH', body })
  },
  { roles: ['ADMIN'] },
)

/** DELETE /api/admin/news-indexer/authors/[id] — delete a person, cascading their aliases. */
export const DELETE = withAuth(
  async (_request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)

    log.info({ userId: user.id, personId: params.id }, 'deleting news-indexer person')
    return proxyAuthorsAdmin(`/authors/${params.id}`, { method: 'DELETE' })
  },
  { roles: ['ADMIN'] },
)
