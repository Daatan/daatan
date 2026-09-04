import v8 from 'v8'
import { NextResponse } from 'next/server'
import { VERSION } from '@/lib/version'
import { checkDatabaseHealth } from '@/lib/services/health'
import { memoryUsageMb, toMb } from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const gitCommit = process.env.GIT_COMMIT || 'unknown'
  const commitShort = gitCommit.substring(0, 7)
  const timestamp = new Date().toISOString()

  const db = await checkDatabaseHealth()
  const status = db ? 'ok' : 'degraded'

  // Process memory in MB (#1725). `heapLimit` is what V8 will let the heap grow to — by
  // default sized from HOST RAM, not the container, hence NODE_OPTIONS in the deploy script.
  const memory = { ...memoryUsageMb(), heapLimit: toMb(v8.getHeapStatistics().heap_size_limit) }

  return NextResponse.json(
    { status, version: VERSION, commit: commitShort, timestamp, env: process.env.APP_ENV ?? 'unknown', db, memory },
    { status: db ? 200 : 503 }
  )
}
