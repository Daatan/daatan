/**
 * Process memory telemetry for the OOM watch (#1725).
 *
 * Kept free of node builtins so `instrumentation.ts` (which Next also compiles for the
 * edge runtime) can import it statically; the V8 heap *limit* needs the `v8` module and
 * is added by the callers that run on node only.
 *
 * Reading the curve: `heapUsed` climbing with `heapTotal` over a day means live objects —
 * take a heap snapshot. `heapUsed` flat while `heapTotal` grows is V8 keeping a heap it
 * was allowed to grow, which `--max-old-space-size` bounds.
 */
export type MemoryUsageMb = {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  uptimeMin: number
}

export const toMb = (bytes: number): number => Math.round(bytes / 1048576)

export function memoryUsageMb(): MemoryUsageMb {
  const m = process.memoryUsage()
  return {
    rss: toMb(m.rss),
    heapUsed: toMb(m.heapUsed),
    heapTotal: toMb(m.heapTotal),
    external: toMb(m.external),
    uptimeMin: Math.round(process.uptime() / 60),
  }
}
