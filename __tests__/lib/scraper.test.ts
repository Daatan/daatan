import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchUrlContent, isPrivateIP } from '@/lib/utils/scraper'
import dns from 'dns'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock dns to return private IPs for some domains
const mockAaaaIps: Record<string, string[]> = {
    'aaaa-only-private.example.com': ['fc00::1'],
}
vi.mock('dns', () => ({
    default: {
        resolve4: (hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void) => {
            const mockIps: Record<string, string[]> = {
                'private.example.com': ['192.168.1.100'],
                'public.example.com': ['8.8.8.8'],
                'cgnat.example.com': ['100.64.1.1'],
                'multicast.example.com': ['224.0.0.1'],
                'benchmark.example.com': ['198.18.0.1'],
                'doc1.example.com': ['192.0.2.1'],
            }
            if (hostname in mockIps) {
                callback(null, mockIps[hostname])
            } else if (hostname in mockAaaaIps) {
                // Simulates a real AAAA-only domain: no A record.
                callback(new Error('ENODATA') as NodeJS.ErrnoException, [])
            } else {
                callback(null, ['9.9.9.9'])
            }
        },
        resolve6: (hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void) => {
            if (hostname in mockAaaaIps) {
                callback(null, mockAaaaIps[hostname])
            } else {
                callback(new Error('ENODATA') as NodeJS.ErrnoException, [])
            }
        }
    }
}))

describe('fetchUrlContent SSRF Protection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockFetch.mockResolvedValue({
            ok: true,
            text: async () => '<html><body>Test Content</body></html>'
        })
    })

    it('rejects HTTP protocol', async () => {
        await expect(fetchUrlContent('http://example.com/test')).rejects.toThrow('Only HTTPS URLs are allowed')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects invalid URL', async () => {
        await expect(fetchUrlContent('not-a-url')).rejects.toThrow('Invalid URL format')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects localhost', async () => {
        await expect(fetchUrlContent('https://localhost/api')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects 127.0.0.1 directly', async () => {
        await expect(fetchUrlContent('https://127.0.0.1/test')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects 169.254.169.254 directly', async () => {
        await expect(fetchUrlContent('https://169.254.169.254/latest/meta-data')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects CG-NAT IP directamente', async () => {
        await expect(fetchUrlContent('https://100.64.0.1/test')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects a bracketed IPv6 loopback literal directly (daatan#1317)', async () => {
        await expect(fetchUrlContent('https://[::1]/admin')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects a bracketed IPv6 unique-local literal directly', async () => {
        await expect(fetchUrlContent('https://[fc00::1]/test')).rejects.toThrow('Fetching internal or private IPs is forbidden')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects a domain whose only record is a private AAAA (no A record)', async () => {
        await expect(fetchUrlContent('https://aaaa-only-private.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects domains that resolve to RFC 1918 private IPs', async () => {
        await expect(fetchUrlContent('https://private.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects domains that resolve to CG-NAT IPs', async () => {
        await expect(fetchUrlContent('https://cgnat.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects domains that resolve to Multicast IPs', async () => {
        await expect(fetchUrlContent('https://multicast.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects domains that resolve to Benchmarking IPs', async () => {
        await expect(fetchUrlContent('https://benchmark.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects domains that resolve to Documentation IPs', async () => {
        await expect(fetchUrlContent('https://doc1.example.com/api')).rejects.toThrow('Resolved domain points to a private/internal IP')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows valid HTTPS URLs with public IPs', async () => {
        const result = await fetchUrlContent('https://public.example.com/test')
        expect(result).toBe('Test Content')
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledWith('https://public.example.com/test', expect.objectContaining({ redirect: 'manual' }))
    })

    it('rejects a redirect to an internal host (SSRF via 302)', async () => {
        // Public initial host, but the server 302-redirects to the metadata IP.
        mockFetch.mockResolvedValueOnce({
            status: 302,
            ok: false,
            headers: { get: (h: string) => (h === 'location' ? 'https://169.254.169.254/latest/meta-data' : null) },
            text: async () => '',
        })
        await expect(fetchUrlContent('https://public.example.com/start'))
            .rejects.toThrow('Fetching internal or private IPs is forbidden')
    })

    it('follows a redirect to another public host and re-validates it', async () => {
        mockFetch
            .mockResolvedValueOnce({
                status: 302,
                ok: false,
                headers: { get: (h: string) => (h === 'location' ? 'https://public.example.com/final' : null) },
                text: async () => '',
            })
            .mockResolvedValueOnce({
                status: 200,
                ok: true,
                headers: { get: () => null },
                text: async () => '<html><body>Final Content</body></html>',
            })
        const result = await fetchUrlContent('https://public.example.com/start')
        expect(result).toContain('Final Content')
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })
})

describe('isPrivateIP (exported)', () => {
  it('returns true for loopback 127.0.0.1', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true)
  })

  it('returns true for ::1 IPv6 loopback', () => {
    expect(isPrivateIP('::1')).toBe(true)
  })

  it('returns true for RFC 1918 10.x.x.x', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true)
    expect(isPrivateIP('10.255.255.255')).toBe(true)
  })

  it('returns true for RFC 1918 192.168.x.x', () => {
    expect(isPrivateIP('192.168.1.1')).toBe(true)
    expect(isPrivateIP('192.168.0.0')).toBe(true)
  })

  it('returns true for RFC 1918 172.16-31.x.x', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true)
    expect(isPrivateIP('172.31.255.255')).toBe(true)
    expect(isPrivateIP('172.15.0.1')).toBe(false) // 172.15 is NOT private
    expect(isPrivateIP('172.32.0.1')).toBe(false) // 172.32 is NOT private
  })

  it('returns true for link-local 169.254.x.x (AWS IMDS)', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true)
  })

  it('returns true for CG-NAT 100.64-127.x.x', () => {
    expect(isPrivateIP('100.64.0.1')).toBe(true)
    expect(isPrivateIP('100.127.255.255')).toBe(true)
    expect(isPrivateIP('100.63.0.1')).toBe(false) // just outside range
  })

  it('returns true for multicast 224-239.x.x.x', () => {
    expect(isPrivateIP('224.0.0.1')).toBe(true)
    expect(isPrivateIP('239.255.255.255')).toBe(true)
  })

  it('returns true for IPv4-mapped IPv6 with private address', () => {
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true)
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true)
  })

  it('returns true for bracketed IPv6 literals, matching URL.hostname\'s format (daatan#1317)', () => {
    expect(isPrivateIP('[::1]')).toBe(true)
    expect(isPrivateIP('[fe80::1]')).toBe(true)
    expect(isPrivateIP('[fc00::1]')).toBe(true)
    expect(isPrivateIP('[::ffff:127.0.0.1]')).toBe(true)
    expect(isPrivateIP('[2001:db8::1]')).toBe(false) // bracketed but public
  })

  it('returns true for IPv6 link-local fe80::/10', () => {
    expect(isPrivateIP('fe80::1')).toBe(true)
    expect(isPrivateIP('fe80::dead:beef')).toBe(true)
    expect(isPrivateIP('febf::1')).toBe(true) // upper bound of fe80::/10
    expect(isPrivateIP('FE80::1')).toBe(true) // uppercase variant
  })

  it('returns true for IPv6 unique-local fc00::/7', () => {
    expect(isPrivateIP('fc00::1')).toBe(true)
    expect(isPrivateIP('fd00::1')).toBe(true)
    expect(isPrivateIP('fdff:ffff::1')).toBe(true)
  })

  it('returns false for global unicast IPv6 addresses', () => {
    expect(isPrivateIP('2001:db8::1')).toBe(false)   // documentation range (not blocked by our checks)
    expect(isPrivateIP('2606:4700::1')).toBe(false)   // Cloudflare
    expect(isPrivateIP('2001:4860:4860::8888')).toBe(false) // Google DNS
  })

  it('returns false for well-known public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
    expect(isPrivateIP('1.1.1.1')).toBe(false)
    expect(isPrivateIP('9.9.9.9')).toBe(false)
  })
})
