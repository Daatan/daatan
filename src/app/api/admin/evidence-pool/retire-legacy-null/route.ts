import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { retireLegacyNullRows } from '@/lib/services/evidence-pool'

/**
 * POST /api/admin/evidence-pool/retire-legacy-null
 *
 * One-off admin action (daatan#1522): stamp every pre-#1231 `oracle_null`-legacy row
 * with the terminal `retired_legacy` reason, so the retry sweep and re-claim path stop
 * treating them as retryable forever (see retireLegacyNullRows). `{ "mode": "apply" }`;
 * **`mode` defaults to `dry-run`**, which only counts the target set and writes nothing —
 * same convention as the remediate/retry routes.
 */
export const POST = withAuth(
  async (request: NextRequest) => {
    const body = (await request.json().catch(() => ({}))) as { mode?: unknown }
    if (body.mode !== undefined && body.mode !== 'dry-run' && body.mode !== 'apply') {
      return apiError("mode must be 'dry-run' or 'apply'", 400)
    }
    try {
      return NextResponse.json(await retireLegacyNullRows(body.mode === 'apply'))
    } catch (error) {
      return handleRouteError(error, 'Legacy oracle_null retirement failed')
    }
  },
  { roles: ['ADMIN'] },
)
