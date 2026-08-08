import { createLogger } from '@/lib/logger'
import dns from 'dns'
import util from 'util'

const log = createLogger('scraper')
const resolve4 = util.promisify(dns.resolve4)
const resolve6 = util.promisify(dns.resolve6)

// Check if an IP address is in a private/local range
export function isPrivateIP(ip: string): boolean {
  // URL.hostname brackets IPv6 literals (e.g. new URL('https://[::1]/').hostname
  // === '[::1]'). Strip them first so every check below — loopback, link-local,
  // unique-local, IPv4-mapped — actually matches; otherwise a bracketed literal
  // skips every branch here and this function wrongly reports it as public.
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1)
  }

  // IPv4 mapped IPv6 addresses
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7)
  }

  // localhost / loopback
  if (ip === '::1' || ip.startsWith('127.')) return true

  // IPv6 link-local (fe80::/10) — fe80:: through febf::
  const lowerIp = ip.toLowerCase()
  if (lowerIp.startsWith('fe8') || lowerIp.startsWith('fe9') ||
      lowerIp.startsWith('fea') || lowerIp.startsWith('feb')) return true

  // IPv6 unique-local (fc00::/7) — the IPv6 equivalent of RFC 1918, fc00:: through fdff::
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true

  // 0.0.0.0/8 (Current network)
  if (ip.startsWith('0.')) return true

  // private network ranges (RFC 1918)
  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true
  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true
  // 172.16.0.0/12
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }

  // Carrier-grade NAT (100.64.0.0/10)
  if (ip.startsWith('100.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 64 && secondOctet <= 127) return true
  }

  // IETF Protocol Assignments (192.0.0.0/24)
  if (ip.startsWith('192.0.0.')) return true

  // Test-Net / Documentation (RFC 5737)
  if (ip.startsWith('192.0.2.')) return true // TEST-NET-1
  if (ip.startsWith('198.51.100.')) return true // TEST-NET-2
  if (ip.startsWith('203.0.113.')) return true // TEST-NET-3

  // Benchmarking (198.18.0.0/15)
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return true

  // link local (AWS IMDS, etc) (169.254.0.0/16)
  if (ip.startsWith('169.254.')) return true

  // Multicast (224.0.0.0/4) and Reserved (240.0.0.0/4) — IPv4 only
  // Guard with includes('.') so pure IPv6 addresses are not misclassified
  // (parseInt stops at ':' and would produce a large decimal like 2001)
  if (ip.includes('.')) {
    const firstOctet = parseInt(ip.split('.')[0], 10)
    if (firstOctet >= 224 && firstOctet <= 239) return true
    if (firstOctet >= 240) return true
  }

  return false
}

/**
 * Validate that a URL is https and resolves only to public IPs. Throws on
 * violation. Called for the initial URL AND every redirect hop.
 */
async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL format')
  }

  // SSRF Protection 1: Enforce HTTPS
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed')
  }

  // SSRF Protection 2: reject internal hosts, then resolve and check the IPs.
  if (isPrivateIP(parsedUrl.hostname) || parsedUrl.hostname === 'localhost') {
    throw new Error('Fetching internal or private IPs is forbidden')
  }
  // Check both A and AAAA records: a domain with no A record but a private
  // AAAA record (e.g. pointing at ::1 or an fc00::/7 address) would otherwise
  // pass this check (resolve4 fails, swallowed below as a genuine DNS miss)
  // and then fetch() — which does support IPv6 — would connect via the
  // unchecked AAAA record anyway.
  for (const resolver of [resolve4, resolve6]) {
    try {
      const ips = await resolver(parsedUrl.hostname)
      for (const ip of ips) {
        if (isPrivateIP(ip)) {
          throw new Error('Resolved domain points to a private/internal IP')
        }
      }
    } catch (dnsErr) {
      // Our own violation bubbles up; a genuine DNS-resolution failure (no
      // record of this type) is left for fetch() to surface as a network
      // error, or is caught by the other resolver's iteration.
      if (dnsErr instanceof Error && dnsErr.message.includes('Resolved domain')) {
        throw dnsErr
      }
    }
  }
}

export async function fetchUrlContent(url: string): Promise<string> {
  try {
    // Re-validate the initial URL and every redirect hop: default fetch follows
    // redirects, so a validated public host could 30x-redirect to an internal
    // one (e.g. 169.254.169.254). redirect:'manual' + per-hop assertSafeUrl
    // closes that bypass.
    let currentUrl = url
    let response: Response | undefined
    for (let hop = 0; hop < 5; hop++) {
      await assertSafeUrl(currentUrl)
      response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      break
    }

    if (!response || !response.ok) {
      throw new Error(`Failed to fetch URL: ${response?.statusText ?? 'too many redirects'}`)
    }

    const html = await response.text()

    // Simple HTML to text extraction
    // Remove scripts and styles
    let text = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, '')
    text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, '')

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ')

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim()

    // Limit text length to avoid token limits (e.g., first 10k characters)
    return text.substring(0, 10000)
  } catch (error) {
    log.error({ err: error, url }, 'Scraper error')
    throw error
  }
}
