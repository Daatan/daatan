import { describe, it, expect } from 'vitest'
import { GET } from '../route'

describe('GET /api/well-known/assetlinks', () => {
  it('serves the real assetlinks.json content with a JSON content type', async () => {
    const res = await GET()

    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = JSON.parse(await res.text())
    expect(body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.daatan.app',
          sha256_cert_fingerprints: [
            '1B:79:A3:BC:73:B1:E0:DF:DC:45:2C:F4:84:F5:77:6C:1E:65:B0:D5:54:D4:44:F8:21:2B:9B:D5:4E:33:CF:18',
          ],
        },
      },
    ])
  })
})
