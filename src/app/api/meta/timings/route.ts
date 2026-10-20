import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const DEFAULT_TIMINGS = { searchMs: 10_000, llmMs: 12_000, oracleMs: 8_000 }
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MIN_SAMPLES = 3


export async function GET() {
  const since = new Date(Date.now() - WINDOW_MS)

  const agg = await prisma.contextTiming.aggregate({
    _avg: { searchMs: true, llmMs: true, oracleMs: true },
    _count: { id: true },
    where: { createdAt: { gte: since } },
  })

  const count = agg._count.id
  if (count < MIN_SAMPLES || agg._avg.searchMs == null) {
    return NextResponse.json({ hasData: false, timings: DEFAULT_TIMINGS })
  }

  return NextResponse.json({
    hasData: true,
    sampleCount: count,
    timings: {
      searchMs: Math.round(agg._avg.searchMs),
      llmMs: Math.round(agg._avg.llmMs!),
      oracleMs: Math.round(agg._avg.oracleMs!),
    },
  })
}
