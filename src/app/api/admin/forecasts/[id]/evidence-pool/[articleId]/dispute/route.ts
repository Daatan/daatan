import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { z } from 'zod'
import { DISPUTE_STATUSES, setUrlDispute } from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-forecast-evidence-dispute')

const disputeSchema = z.object({
  status: z.enum(DISPUTE_STATUSES),
  note: z.string().max(1000).nullable().optional(),
})

/**
 * PATCH /api/admin/forecasts/[id]/evidence-pool/[articleId]/dispute  body: { status, note? }
 * Set the public dispute state (disputed | upheld | hidden) of the URL behind one pooled
 * article (elections#225). Applies per URL, across every forecast's pool — see
 * setUrlDispute in evidence-pool.ts. `note` is internal and never rendered publicly.
 */
export const PATCH = withAuth(
  async (request, _user, { params }) => {
    const { status, note } = disputeSchema.parse(await request.json())

    const result = await setUrlDispute(params.id, params.articleId, status, note)
    if (!result) return apiError('Article not found in this forecast\'s pool', 404)

    log.info(
      { predictionId: params.id, articleId: params.articleId, urlHash: result.dispute.urlHash, status, excludedRows: result.excludedRows },
      'Set evidence URL dispute status',
    )
    return NextResponse.json(result)
  },
  { roles: ['ADMIN'] },
)
