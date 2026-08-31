import { describe, it, expect } from 'vitest'
import { GET } from '../route'

// NOTE: this is a snapshot of the served file, nothing more. It proves the route
// serves assetlinks.json with the right content type — it CANNOT tell you whether
// the fingerprints are the keys Google Play actually signs with. A wrong fingerprint
// passes this test forever (it did: see #1697, where the Play App Signing entry was
// wrong for 5 weeks and every Play install rendered with a browser URL bar).
//
// The only real verification is on a device: install FROM Google Play, then confirm
// no URL bar renders and that logcat shows TWAConnectionPool/DelegationService
// binding. Sideloads use the *upload* key and prove nothing about the Play path.
// See android/README.md.
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
            'B0:60:24:A9:53:C7:3E:7F:50:49:99:15:4D:D9:4C:9A:A5:22:14:5B:7A:8C:0D:3C:A7:D4:66:3C:A4:B9:42:90',
            'FC:BE:B0:3B:52:02:3C:46:75:27:E0:B5:4D:2E:C9:E9:E4:69:56:50:AD:63:0C:BB:08:D5:43:99:4E:DA:81:52',
          ],
        },
      },
    ])
  })
})
