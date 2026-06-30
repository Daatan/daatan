import { NextResponse } from 'next/server'
import { isSelfHosted } from '@/lib/edition'

/**
 * Guard for features that are disabled in the self_hosted edition (the bot
 * system). Returns a 404 response on self-host (so the route looks absent),
 * or null on SaaS to let the handler run. Call as the first line of a handler:
 *
 *   const blocked = blockedOnSelfHost(); if (blocked) return blocked
 */
export function blockedOnSelfHost(): NextResponse | null {
  return isSelfHosted() ? NextResponse.json({ error: 'Not found' }, { status: 404 }) : null
}
