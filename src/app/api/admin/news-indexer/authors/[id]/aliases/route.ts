import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { parseJsonBody } from '@/lib/api-body'
import { forwardedObjectBodySchema } from '@/lib/validations/api-inputs'
import { isUuid, proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'


const log = createLogger('admin-news-indexer-authors')

/** POST /api/admin/news-indexer/authors/[id]/aliases — add a byline or channel-name alias. */
export const POST = withAuth(
  async (request, user, { params }) => {
    if (!isUuid(params.id)) return apiError('Invalid person id', 400)

    const body = await parseJsonBody(request, forwardedObjectBodySchema)

    log.info({ userId: user.id, personId: params.id }, 'adding news-indexer alias')
    return proxyAuthorsAdmin(`/authors/${params.id}/aliases`, { method: 'POST', body })
  },
  { roles: ['ADMIN'] },
)
