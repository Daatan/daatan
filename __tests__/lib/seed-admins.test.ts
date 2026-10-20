import { describe, it, expect, vi } from 'vitest'
import {
  resolveAdminTargets,
  seedAdmins,
  SAAS_OWNER_EMAILS,
  SAAS_OWNER_USER_IDS,
} from '../../prisma/seed-admins'

describe('resolveAdminTargets', () => {
  it('parses ADMIN_EMAIL (comma/space separated, lowercased) and skips the SaaS IDs', () => {
    expect(resolveAdminTargets({ ADMIN_EMAIL: 'A@Org.example, b@org.example  c@org.example' })).toEqual({
      emails: ['a@org.example', 'b@org.example', 'c@org.example'],
      userIds: [],
    })
  })

  it('falls back to the SaaS owners when ADMIN_EMAIL is unset on the SaaS edition', () => {
    expect(resolveAdminTargets({})).toEqual({ emails: SAAS_OWNER_EMAILS, userIds: SAAS_OWNER_USER_IDS })
  })

  it('refuses to fall back to the SaaS owners on a self-hosted install', () => {
    expect(() => resolveAdminTargets({ DAATAN_EDITION: 'self_hosted' })).toThrow(/ADMIN_EMAIL is required/)
  })

  it('rejects an ADMIN_EMAIL with no addresses', () => {
    expect(() => resolveAdminTargets({ ADMIN_EMAIL: ' , ' })).toThrow(/no email addresses/)
  })
})

describe('seedAdmins', () => {
  function fakePrisma() {
    return {
      user: {
        upsert: vi.fn(async ({ create }: { create: { email: string } }) => ({ id: 'u1', email: create.email, role: 'ADMIN' })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }
  }

  it('upserts each email as ADMIN, creating it with a username from the local part', async () => {
    const prisma = fakePrisma()
    await seedAdmins(prisma as never, { emails: ['admin@org.example'], userIds: [] }, () => {})
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { email: 'admin@org.example' },
      update: { role: 'ADMIN' },
      create: { email: 'admin@org.example', name: 'admin', username: 'admin', role: 'ADMIN' },
    })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('promotes listed user IDs without failing when they are absent', async () => {
    const prisma = fakePrisma()
    await seedAdmins(prisma as never, { emails: [], userIds: ['missing-id'] }, () => {})
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'missing-id' }, data: { role: 'ADMIN' } })
  })
})
