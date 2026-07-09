import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { z } from 'zod'
import { setArticleExcluded } from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-forecast-evidence-pool')

export const dynamic = 'force-dynamic'

const excludeSchema = z.object({ excluded: z.boolean() })

/**
 * PATCH /api/admin/forecasts/[id]/evidence-pool/[articleId]  body: { excluded }
 * Toggle one pooled article's admin exclusion flag. See evidence-pool.ts for
 * why this has no effect on the live estimate yet.
 */
export const PATCH = withAuth(
  async (request, _user, { params }) => {
    const { excluded } = excludeSchema.parse(await request.json())

    const article = await setArticleExcluded(params.id, params.articleId, excluded)
    if (!article) return apiError('Article not found in this forecast\'s pool', 404)

    log.info({ predictionId: params.id, articleId: params.articleId, excluded }, 'Set pool article exclusion')
    return NextResponse.json({ article })
  },
  { roles: ['ADMIN'] },
)
