import { PrismaClient, Prisma } from '@prisma/client'
import { env } from '@/env'
import { logPrismaErrorEvent } from '@/lib/prisma-log'

declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | undefined
}

// Create Prisma client using the pg driver adapter (required by Prisma v7).
// pg and @prisma/adapter-pg are loaded via require() inside the function body
// so webpack does not statically bundle them (they use Node.js built-ins that
// are unavailable in the edge runtime compilation).
const createPrismaClient = (): PrismaClient => {
  const { Pool } = require('pg') as typeof import('pg') // eslint-disable-line
  const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg') // eslint-disable-line
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  // 'error' is event-emitted (not stdout) so the expected P2002 claim
  // collisions from evidence-pool.ts can be dropped before they hit the log —
  // see prisma-log.ts and daatan#1502. query/warn keep their stdout behavior.
  const client = new PrismaClient<Prisma.PrismaClientOptions, 'error'>({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? ['query', 'warn', { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  })
  client.$on('error', logPrismaErrorEvent)
  return client
}

// Use cached client in development to prevent hot-reload connection exhaustion
export const prisma: PrismaClient = global.prismaClient ?? createPrismaClient()

if (env.NODE_ENV !== 'production') {
  global.prismaClient = prisma
}

export default prisma
