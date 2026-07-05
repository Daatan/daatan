import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('email-service')

let _resend: Resend | null = null
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  return (_resend ??= new Resend(process.env.RESEND_API_KEY))
}

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://daatan.com'
// APP_ENV, not NEXT_PUBLIC_ENV: staging runs the same promoted Docker image as
// production, so this must read the runtime instance var — see src/env.ts.
const isStaging = process.env.APP_ENV === 'staging'

/**
 * Dispatch a transactional email to a user.
 * Fire-and-forget: never throws, logs errors. Skipped when RESEND_API_KEY is absent.
 */
export async function dispatchEmail(params: {
  userId: string
  title: string
  message: string
  link?: string | null
}): Promise<void> {
  const client = getResend()
  if (!client) return

  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, emailNotifications: true },
    })
    if (!user?.email || !user.emailNotifications) return

    const subject = isStaging ? `[staging] ${params.title}` : params.title
    const from = process.env.EMAIL_FROM ?? 'Daatan <noreply@daatan.com>'

    await client.emails.send({
      from,
      to: user.email,
      subject,
      html: buildEmailHtml(params),
    })

    log.debug({ userId: params.userId }, 'Email dispatched')
  } catch (err) {
    log.error({ err }, 'Failed to dispatch email notification')
  }
}

function buildEmailHtml(params: { title: string; message: string; link?: string | null }): string {
  const buttonHtml = params.link
    ? `<p style="margin:32px 0 0">
        <a href="${APP_URL}${params.link}"
           style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          View &rarr;
        </a>
      </p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb">
        <tr><td>
          <h2 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(params.title)}</h2>
          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.6">${escapeHtml(params.message)}</p>
          ${buttonHtml}
          <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:12px;color:#9ca3af">
            You received this email because you have notifications enabled on
            <a href="${APP_URL}" style="color:#6b7280">Daatan</a>.
            Manage your preferences in your profile settings.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
