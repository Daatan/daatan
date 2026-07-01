import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { resetPasswordSchema } from '@/lib/validations/auth'
import { resetUserPassword } from '@/lib/services/auth-email'
import { createLogger } from '@/lib/logger'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'

const log = createLogger('reset-password')

export async function POST(req: NextRequest) {
  // Gate before the cost-12 bcrypt hash — otherwise unauthenticated callers can
  // force expensive hashing (CPU DoS) and brute-force reset tokens unboundedly.
  const rl = checkRateLimit(`reset-password:${clientIp(req)}`, 5, 60 * 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)
  try {
    const body = await req.json()
    const { email, token, password } = resetPasswordSchema.parse(body)

    const hashed = await bcrypt.hash(password, 12)
    const ok = await resetUserPassword(email, token, hashed)

    if (!ok) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
    }

    log.info({ email }, 'Password reset successful')
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error({ err }, 'reset-password error')
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
