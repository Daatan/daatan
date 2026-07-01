/**
 * Telegram webhook for rollback commands.
 *
 * Commands:
 *   /versions        — List available ECR version tags
 *   /status          — Show versions currently running on prod and staging
 *   /rollback 1.7.x  — Trigger GitHub Actions rollback workflow for production
 *   /rollback staging 1.7.x — Trigger rollback for staging
 *
 * Security: only allowed Telegram chat IDs can use these commands.
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN          — Bot token from BotFather
 *   TELEGRAM_WEBHOOK_SECRET     — Secret token registered with Telegram's setWebhook
 *                                 (secret_token). REQUIRED: the endpoint fails closed
 *                                 without it, since it's the only proof a request is
 *                                 genuinely from Telegram.
 *   TELEGRAM_ROLLBACK_CHAT_IDS  — Comma-separated allowed chat IDs (e.g. "123456,789012")
 *   GH_ROLLBACK_TOKEN           — PAT with actions:write on this repo
 *   GITHUB_REPOSITORY           — e.g. "Daatan/daatan"
 *   AWS_REGION                  — e.g. "eu-central-1"
 *   NEXTAUTH_URL                — production base URL (e.g. "https://daatan.com")
 *   STAGING_URL                 — staging base URL (e.g. "https://staging.daatan.com")
 */

import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('telegram-rollback')

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const GITHUB_REPO = process.env.GITHUB_REPOSITORY ?? 'Daatan/daatan'
const GITHUB_TOKEN = process.env.GH_ROLLBACK_TOKEN ?? ''
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ROLLBACK_CHAT_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''

async function sendMessage(chatId: number | string, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
}

async function getAvailableVersions(): Promise<string[]> {
  // Fetch versions from GitHub Actions API (lists recent workflow runs) —
  // easier than hitting ECR directly from Next.js without AWS SDK.
  // We parse recent successful deploy run titles to extract version numbers.
  // Fallback: return empty list if unavailable.
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/deploy.yml/runs?status=success&per_page=30`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
        next: { revalidate: 0 },
      },
    )
    if (!resp.ok) return []
    const data = await resp.json()
    const versions = new Set<string>()
    for (const run of data.workflow_runs ?? []) {
      // Extract semver from run name or head_branch (e.g. "v1.7.174" → "1.7.174")
      const match = (run.display_title ?? run.name ?? '').match(/v?(\d+\.\d+\.\d+)/)
      if (match) versions.add(match[1])
    }
    return [...versions].sort((a, b) => {
      const [am, an, ap] = a.split('.').map(Number)
      const [bm, bn, bp] = b.split('.').map(Number)
      return bm - am || bn - an || bp - ap
    })
  } catch {
    return []
  }
}

async function getCurrentVersions(): Promise<{ prod: string; staging: string }> {
  const [prodResp, stagingResp] = await Promise.allSettled([
    fetch(`${process.env.NEXTAUTH_URL ?? 'https://daatan.com'}/api/health`, { next: { revalidate: 0 } }),
    fetch(`${process.env.STAGING_URL ?? 'https://staging.daatan.com'}/api/health`, { next: { revalidate: 0 } }),
  ])
  const parse = async (r: PromiseSettledResult<Response>) => {
    if (r.status !== 'fulfilled' || !r.value.ok) return 'unknown'
    try {
      const d = await r.value.json()
      return (d.version as string) ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }
  const [prod, staging] = await Promise.all([parse(prodResp), parse(stagingResp)])
  return { prod, staging }
}

async function triggerRollback(
  environment: 'production' | 'staging',
  version: string,
  reason: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/rollback.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { environment, version, reason },
      }),
    },
  )
  if (!resp.ok) {
    const err = await resp.text().catch(() => 'unknown error')
    return { ok: false, error: err }
  }
  // GitHub returns 204 No Content on success — fetch the run URL separately
  await new Promise((r) => setTimeout(r, 2000))
  const runsResp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/rollback.yml/runs?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
  const url =
    runsResp.ok
      ? (await runsResp.json().then((d) => d.workflow_runs?.[0]?.html_url).catch(() => undefined))
      : undefined
  return { ok: true, url }
}

export async function POST(request: Request) {
  try {
    // Fail closed: the webhook secret is the only proof a request actually came
    // from Telegram. Without it, anyone who can reach this URL and supplies an
    // allowed chat_id in the body could trigger a production rollback. If the
    // secret isn't configured, refuse every request rather than trust the body.
    if (!WEBHOOK_SECRET) {
      log.error('TELEGRAM_WEBHOOK_SECRET is not configured — rejecting rollback webhook request')
      return NextResponse.json({ ok: true }) // 200 to avoid Telegram retries
    }
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (!secretsMatch(secretHeader, WEBHOOK_SECRET)) {
      return NextResponse.json({ ok: true }) // 200 to avoid Telegram retries
    }

    const body = await request.json()
    const message = body?.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId = message.chat?.id
    const text: string = message.text ?? ''

    // Reject unauthorized chats
    if (!ALLOWED_CHAT_IDS.includes(String(chatId))) {
      await sendMessage(chatId, '⛔ You are not authorized to use this bot.')
      return NextResponse.json({ ok: true })
    }

    // Reject non-commands
    if (!text.startsWith('/')) {
      await sendMessage(
        chatId,
        'Commands:\n/status — current versions\n/versions — available versions\n/rollback 1.7.x — roll back production\n/rollback staging 1.7.x — roll back staging',
      )
      return NextResponse.json({ ok: true })
    }

    const parts = text.trim().split(/\s+/)
    const cmd = parts[0].toLowerCase()

    if (cmd === '/status' || cmd === '/status@daatanbot') {
      await sendMessage(chatId, '⏳ Checking live versions...')
      const { prod, staging } = await getCurrentVersions()
      await sendMessage(
        chatId,
        `🌐 <b>Current versions</b>\n\nProduction: <code>${prod}</code>\nStaging: <code>${staging}</code>`,
      )
      return NextResponse.json({ ok: true })
    }

    if (cmd === '/versions' || cmd === '/versions@daatanbot') {
      await sendMessage(chatId, '⏳ Fetching available versions...')
      const versions = await getAvailableVersions()
      if (versions.length === 0) {
        await sendMessage(chatId, '⚠️ Could not fetch version list. Check GitHub Actions directly.')
      } else {
        const list = versions.slice(0, 15).map((v) => `  • ${v}`).join('\n')
        await sendMessage(
          chatId,
          `📦 <b>Available versions</b> (newest first):\n\n${list}\n\nUse: <code>/rollback 1.7.x</code>`,
        )
      }
      return NextResponse.json({ ok: true })
    }

    if (cmd === '/rollback' || cmd === '/rollback@daatanbot') {
      // /rollback 1.7.x  or  /rollback staging 1.7.x
      let environment: 'production' | 'staging' = 'production'
      let version = ''

      if (parts.length === 3 && (parts[1] === 'production' || parts[1] === 'staging')) {
        environment = parts[1] as 'production' | 'staging'
        version = parts[2]
      } else if (parts.length === 2) {
        version = parts[1]
      } else {
        await sendMessage(
          chatId,
          '❌ Usage:\n<code>/rollback 1.7.x</code> — rolls back production\n<code>/rollback staging 1.7.x</code> — rolls back staging',
        )
        return NextResponse.json({ ok: true })
      }

      // Validate version format
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        await sendMessage(
          chatId,
          `❌ Invalid version format: <code>${version}</code>\nExpected format: <code>1.7.174</code>`,
        )
        return NextResponse.json({ ok: true })
      }

      const actor = message.from?.username ?? message.from?.first_name ?? 'unknown'
      await sendMessage(
        chatId,
        `🔄 Triggering rollback of <b>${environment}</b> to v<code>${version}</code>...\nRequested by @${actor}`,
      )

      const result = await triggerRollback(environment, version, `Requested by @${actor} via Telegram`)
      if (!result.ok) {
        await sendMessage(
          chatId,
          `❌ Failed to trigger rollback.\n<code>${result.error?.slice(0, 300)}</code>`,
        )
      } else {
        const logLink = result.url ? `\n<a href="${result.url}">View progress →</a>` : ''
        await sendMessage(
          chatId,
          `✅ Rollback workflow started!\n\n${environment} → v${version}${logLink}\n\nYou'll get a notification when it completes.`,
        )
      }
      return NextResponse.json({ ok: true })
    }

    // Unknown command
    await sendMessage(
      chatId,
      'Unknown command. Try:\n/status\n/versions\n/rollback 1.7.x',
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error({ err }, 'Telegram rollback webhook error')
    return NextResponse.json({ ok: true }) // Always 200 to Telegram
  }
}
