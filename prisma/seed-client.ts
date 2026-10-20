import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Prisma 7 has no built-in engine connection: a client needs a driver adapter,
// exactly like src/lib/prisma.ts. That module can't be reused here because it
// pulls in the full app env validation (@/env), which a one-off seed run from
// the migrations container doesn't have. Passing a connection string (not a
// Pool) lets the adapter own the pool, so $disconnect() closes it and the
// process exits.
export function createSeedPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
