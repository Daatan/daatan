// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

/**
 * The in-app /elections matrix was removed in favour of elections.daatan.com
 * (daatan#2011); these redirects keep its old URLs alive.
 */

const require = createRequire(import.meta.url)
const PROJECT_ROOT = path.resolve(__dirname, '../..')

type Redirect = { source: string; destination: string; permanent: boolean }

async function loadRedirects(): Promise<Redirect[]> {
  const config = require(path.join(PROJECT_ROOT, 'next.config.js'))
  return config.redirects()
}

async function resolve(pathname: string): Promise<string | null> {
  const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match')
  for (const r of await loadRedirects()) {
    const params = getPathMatch(r.source)(pathname)
    if (!params) continue
    const rest = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '')
    return r.destination.replace(':path*', rest).replace(':id', params.id ?? '')
  }
  return null
}

describe('next.config redirects', () => {
  it('sends /elections and its locale variants to the elections app, permanently', async () => {
    expect(await resolve('/elections')).toBe('https://elections.daatan.com/')
    expect(await resolve('/he/elections')).toBe('https://elections.daatan.com/')
    expect(await resolve('/elections/resolved')).toBe('https://elections.daatan.com/resolved')

    const elections = (await loadRedirects()).filter((r) => r.destination.startsWith('https://elections.daatan.com'))
    expect(elections.length).toBeGreaterThan(0)
    expect(elections.every((r) => r.permanent)).toBe(true)
  })

  it('leaves the elections tag page alone', async () => {
    expect(await resolve('/tags/elections')).toBeNull()
  })
})
