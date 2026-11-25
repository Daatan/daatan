/**
 * Logos of board outlets, bundled under `public/outlet-logos/<key>.png` (daatan#2341). Keys are
 * canonical outlet names (`canonicalOutlet`), sizes are the files' pixel sizes. Where each file
 * comes from and its licence: docs/OUTLET_LOGOS.md.
 */
export const OUTLET_LOGOS: Record<string, { width: number; height: number }> = {
  'aa.com.tr': { width: 960, height: 1018 },
  'aljazeera.net': { width: 960, height: 325 },
  'bbc.com': { width: 960, height: 615 },
  'cnbc.com': { width: 960, height: 307 },
  'finance.yahoo.com': { width: 960, height: 352 },
  'foreignpolicy.com': { width: 960, height: 608 },
  'fortune.com': { width: 960, height: 221 },
  'jns.org': { width: 288, height: 90 },
  'jpost.com': { width: 960, height: 146 },
  'kikar.co.il': { width: 960, height: 919 },
  'kyivpost.com': { width: 960, height: 143 },
  'lemonde.fr': { width: 960, height: 222 },
  'meduza.io': { width: 960, height: 202 },
  'pravda.com.ua': { width: 960, height: 131 },
  'tehrantimes.com': { width: 960, height: 102 },
  'theguardian.com': { width: 960, height: 316 },
  'thehill.com': { width: 960, height: 136 },
  'timesofindia.indiatimes.com': { width: 960, height: 68 },
  'ynet.co.il': { width: 960, height: 413 },
}

/** The header box a logo is scaled into: wordmarks run up to 14:1, marks are near square. */
const MAX_WIDTH = 160
const MAX_HEIGHT = 40

export interface OutletLogo {
  src: string
  /** Display size within the header box, aspect ratio kept. */
  width: number
  height: number
}

/** The logo of the first key that has one; pass canonical keys. */
export function outletLogo(keys: Iterable<string | null>): OutletLogo | null {
  for (const key of keys) {
    if (key === null || !Object.hasOwn(OUTLET_LOGOS, key)) continue
    const size = OUTLET_LOGOS[key]
    const scale = Math.min(MAX_WIDTH / size.width, MAX_HEIGHT / size.height)
    return {
      src: `/outlet-logos/${key}.png`,
      width: Math.round(size.width * scale),
      height: Math.max(1, Math.round(size.height * scale)),
    }
  }
  return null
}
