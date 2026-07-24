import { readFile } from 'fs/promises'
import path from 'path'

/**
 * Serves public/.well-known/assetlinks.json for the Android TWA's Digital
 * Asset Links check. Next.js's static file server 404s any public/ path
 * with a dot-prefixed segment (a security default), so /.well-known/* is
 * unreachable directly — next.config.js rewrites it here instead.
 */
export async function GET() {
  const filePath = path.join(process.cwd(), 'public/.well-known/assetlinks.json')
  const content = await readFile(filePath, 'utf-8')
  return new Response(content, {
    headers: { 'Content-Type': 'application/json' }
  })
}
