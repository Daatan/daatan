import v8 from 'v8'
import { NextResponse } from 'next/server'
import { VERSION } from '@/lib/version'
import { checkDatabaseHealth } from '@/lib/services/health'
import { memoryUsageMb, toMb } from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// #1725 proposal 5: recycle the container on sustained memory pressure before the 2 GiB
// cgroup limit (docker-compose.prod.yml / blue-green-deploy.sh) SIGKILLs it mid-request.
// This alone does nothing — Docker's `--restart unless-stopped` restarts on process *exit*,
// not on a failed healthcheck — the watchdog.yml disk-watchdog job is what turns a sustained
// 503 here into a `docker restart daatan-app`. 1600 MB sits below the 2048 MB cgroup limit
// with margin for the restart's own grace period, and above the ~1.4 GB day-old plateau
// PR#1727 observed after capping the V8 heap at 1280 MB.
const MEMORY_PRESSURE_RSS_MB = 1600

export async function GET() {
  const gitCommit = process.env.GIT_COMMIT || 'unknown'
  const commitShort = gitCommit.substring(0, 7)
  const timestamp = new Date().toISOString()

  const db = await checkDatabaseHealth()

  // Process memory in MB (#1725). `heapLimit` is what V8 will let the heap grow to — by
  // default sized from HOST RAM, not the container, hence NODE_OPTIONS in the deploy script.
  const memory = { ...memoryUsageMb(), heapLimit: toMb(v8.getHeapStatistics().heap_size_limit) }
  const memoryPressure = memory.rss > MEMORY_PRESSURE_RSS_MB

  const healthy = db && !memoryPressure
  const status = !db ? 'degraded' : memoryPressure ? 'memory-pressure' : 'ok'

  return NextResponse.json(
    { status, version: VERSION, commit: commitShort, timestamp, env: process.env.APP_ENV ?? 'unknown', db, memory },
    { status: healthy ? 200 : 503 }
  )
}
