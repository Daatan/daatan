import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { registerSchema } from '@/lib/validations/auth'
import { apiError, handleRouteError } from '@/lib/api-error'
import { slugify } from '@/lib/utils/slugify'
import { createLogger } from '@/lib/logger'
import { notifyNewUserRegistered } from '@/lib/services/telegram'
import { findUserByEmail, findUsernameCollisions, registerUser } from '@/lib/services/user'
import { checkRateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { env } from '@/env'
import { isEmailDomainAllowed, isOpenSignupEnabled, parseAllowedDomains } from '@/lib/auth/access'

const log = createLogger('api-auth-signup')

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  // Closed-signup gate (self-host). No-op for SaaS, which is always open.
  if (!isOpenSignupEnabled(env.DAATAN_EDITION, env.SELF_HOST_OPEN_SIGNUP)) {
    return apiError('Public signup is disabled', 403)
  }

  try {
    const body = await req.json()
    const validatedData = registerSchema.parse(body)
    const { name, email, password } = validatedData

    // Domain allow-list (self-host). No-op when ALLOWED_EMAIL_DOMAINS is unset.
    if (!isEmailDomainAllowed(email, parseAllowedDomains(env.ALLOWED_EMAIL_DOMAINS))) {
      return apiError('Email domain not allowed', 403)
    }

    const existingUser = await findUserByEmail(email)
    if (existingUser) {
      return apiError('User with this email already exists', 400)
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const baseUsername = slugify(name).replace(/-/g, '_')
    const baseSlug = slugify(name)

    const collisions = await findUsernameCollisions(baseUsername, baseSlug)

    const existingUsernames = collisions.map(c => c.username).filter((u): u is string => !!u)
    const existingSlugs = collisions.map(c => c.slug).filter((s): s is string => !!s)

    let username = baseUsername
    let slug = baseSlug
    let counter = 1

    while (existingUsernames.includes(username)) {
      username = `${baseUsername}${counter}`
      counter++
    }

    counter = 1
    while (existingSlugs.includes(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    const newUser = await registerUser({ name, email, hashedPassword, username, slug })

    log.info({ userId: newUser.id, email: newUser.email }, 'User registered successfully')

    notifyNewUserRegistered({
      email: newUser.email!,
      name: newUser.name,
      provider: 'credentials',
    })

    return NextResponse.json({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      username: newUser.username,
    }, { status: 201 })

  } catch (error) {
    return handleRouteError(error, 'Failed to register user')
  }
}
