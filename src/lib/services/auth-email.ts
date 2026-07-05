/**
 * Auth email service — handles transactional emails and token management for
 * email verification and password reset flows.
 *
 * Unlike dispatchEmail(), this sends directly via Resend without checking
 * user.emailNotifications, because auth emails are always mandatory.
 */

import { randomBytes } from 'crypto'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth-email')

const APP_URL    = process.env.NEXTAUTH_URL ?? 'https://daatan.com'
const FROM       = process.env.EMAIL_FROM   ?? 'Daatan <noreply@daatan.com>'
// APP_ENV, not NEXT_PUBLIC_ENV: staging runs the same promoted Docker image as
// production, so this must read the runtime instance var — see src/env.ts.
const isStaging  = process.env.APP_ENV === 'staging'

let _resend: Resend | null = null
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  return (_resend ??= new Resend(process.env.RESEND_API_KEY))
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Creates (or replaces) a VerificationToken for the given email + purpose.
 * - 'verify' → identifier = email         (24h TTL recommended)
 * - 'reset'  → identifier = "reset:email" (1h TTL recommended)
 */
export async function createVerificationToken(
  email:   string,
  purpose: 'verify' | 'reset',
  ttlMs:   number,
): Promise<string> {
  const identifier = purpose === 'reset' ? `reset:${email}` : email
  const token      = generateToken()
  const expires    = new Date(Date.now() + ttlMs)

  // Replace any existing token for this identifier
  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({ data: { identifier, token, expires } })

  return token
}

export async function deleteVerificationToken(identifier: string, token: string): Promise<void> {
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier, token } },
  })
}

export async function resetUserPassword(email: string, token: string, hashedPassword: string): Promise<boolean> {
  const identifier = `reset:${email}`
  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier, token } },
  })

  if (!record || record.expires < new Date()) return false

  await prisma.user.update({ where: { email }, data: { password: hashedPassword } })
  await deleteVerificationToken(identifier, token)

  return true
}

// ---------------------------------------------------------------------------
// Email senders
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const client = getResend()
  if (!client) {
    log.warn('RESEND_API_KEY not set — skipping verification email')
    return
  }

  const link    = `${APP_URL}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(to)}`
  const subject = isStaging ? '[staging] Verify your email' : 'Verify your email'

  try {
    await client.emails.send({
      from: FROM,
      to,
      subject,
      html: buildAuthEmail({
        title:      'Verify your email address',
        message:    'Click the button below to verify your email and activate your Daatan account. This link expires in 24 hours.',
        buttonText: 'Verify email',
        link,
      }),
    })
    log.debug({ to }, 'Verification email sent')
  } catch (err) {
    log.error({ err, to }, 'Failed to send verification email')
  }
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const client = getResend()
  if (!client) {
    log.warn('RESEND_API_KEY not set — skipping password reset email')
    return
  }

  const link    = `${APP_URL}/auth/reset-password?token=${token}&email=${encodeURIComponent(to)}`
  const subject = isStaging ? '[staging] Reset your password' : 'Reset your password'

  try {
    await client.emails.send({
      from: FROM,
      to,
      subject,
      html: buildAuthEmail({
        title:      'Reset your password',
        message:    'Click the button below to set a new password. This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
        buttonText: 'Reset password',
        link,
      }),
    })
    log.debug({ to }, 'Password reset email sent')
  } catch (err) {
    log.error({ err, to }, 'Failed to send password reset email')
  }
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildAuthEmail(params: {
  title:      string
  message:    string
  buttonText: string
  link:       string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb">
        <tr><td>
          <h2 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(params.title)}</h2>
          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.6">${escapeHtml(params.message)}</p>
          <p style="margin:32px 0 0">
            <a href="${params.link}"
               style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
              ${escapeHtml(params.buttonText)} &rarr;
            </a>
          </p>
          <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:12px;color:#9ca3af">
            This is a security email from
            <a href="${APP_URL}" style="color:#6b7280">Daatan</a>.
            If you did not request this, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
