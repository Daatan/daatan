import type { PrismaClient } from '@prisma/client'

// Used only when ADMIN_EMAIL is unset on the SaaS edition (dev/staging/prod).
export const SAAS_OWNER_EMAILS = ['komapc@gmail.com', 'andrey1bar@gmail.com']

// SaaS prod accounts created via OAuth under a different email mapping
// (duplicate-account edge case). Absent on any other database — skipped.
export const SAAS_OWNER_USER_IDS = [
  'cml6p9bqz0000jnyvw6tx5uzq',
  'cml7r4krc0000fjmqkxz3rrwg',
]

export type AdminTargets = { emails: string[]; userIds: string[] }

/**
 * ADMIN_EMAIL (comma/space separated) names the admin(s) to bootstrap. A
 * self-hosted install must set it: falling back to the SaaS owners there
 * would grant admin to accounts that have nothing to do with the install.
 */
export function resolveAdminTargets(env: { ADMIN_EMAIL?: string; DAATAN_EDITION?: string }): AdminTargets {
  if (env.ADMIN_EMAIL !== undefined) {
    const emails = env.ADMIN_EMAIL.split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    if (emails.length === 0) {
      throw new Error('ADMIN_EMAIL is set but contains no email addresses')
    }
    return { emails, userIds: [] }
  }
  if (env.DAATAN_EDITION === 'self_hosted') {
    throw new Error('ADMIN_EMAIL is required on a self-hosted install (DAATAN_EDITION=self_hosted)')
  }
  return { emails: SAAS_OWNER_EMAILS, userIds: SAAS_OWNER_USER_IDS }
}

type SeedPrisma = Pick<PrismaClient, 'user'>

export async function seedAdmins(prisma: SeedPrisma, targets: AdminTargets, log: (msg: string) => void = console.log) {
  for (const email of targets.emails) {
    const localPart = email.split('@')[0]
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN' },
      create: {
        email,
        name: localPart, // Replaced on first login
        username: localPart,
        role: 'ADMIN',
      },
    })
    log(`User ${user.email} -> role=${user.role} (id=${user.id})`)
  }

  for (const id of targets.userIds) {
    const { count } = await prisma.user.updateMany({ where: { id }, data: { role: 'ADMIN' } })
    if (count > 0) log(`User by ID ${id} -> role=ADMIN`)
  }
}
