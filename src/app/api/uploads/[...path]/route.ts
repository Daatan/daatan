import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { env } from '@/env'

export const dynamic = 'force-dynamic'

const DEFAULT_LOCAL_PATH = '/data/uploads'

const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/**
 * Serve objects written by the local storage driver (STORAGE_DRIVER=local).
 * No-op (404) for the S3/MinIO drivers, where the object store serves directly.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (env.STORAGE_DRIVER !== 'local') {
    return new NextResponse('Not found', { status: 404 })
  }

  const base = path.resolve(env.STORAGE_LOCAL_PATH || DEFAULT_LOCAL_PATH)
  const { path: segments } = await params
  const resolved = path.resolve(base, ...segments)

  // Guard against path traversal — the resolved path must stay under base.
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const data = await fs.readFile(resolved)
    const ext = path.extname(resolved).toLowerCase()
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
