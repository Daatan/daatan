import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTLET_LOGOS, outletLogo } from '../outlet-logos'

const DIR = join(process.cwd(), 'public', 'outlet-logos')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(join(DIR, file))
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

describe('OUTLET_LOGOS', () => {
  it('has exactly one file in public/outlet-logos per entry, and no stray files', () => {
    const files = readdirSync(DIR).filter((f) => f !== 'README.md').sort()
    expect(files).toEqual(Object.keys(OUTLET_LOGOS).map((k) => `${k}.png`).sort())
  })

  it('records each file at its real pixel size', () => {
    for (const [key, size] of Object.entries(OUTLET_LOGOS)) {
      expect(pngSize(`${key}.png`), key).toEqual(size)
    }
  })
})

describe('outletLogo', () => {
  it('returns the first key that has a logo', () => {
    expect(outletLogo(['Ynet', 'ynet.co.il'])?.src).toBe('/outlet-logos/ynet.co.il.png')
  })

  it('returns null when no key has one, including prototype names', () => {
    expect(outletLogo(['oilprice.com', 'constructor', 'toString'])).toBeNull()
    expect(outletLogo([])).toBeNull()
  })

  it('fits wide wordmarks by width and square marks by height', () => {
    expect(outletLogo(['timesofindia.indiatimes.com'])).toMatchObject({ width: 160, height: 11 })
    expect(outletLogo(['kikar.co.il'])).toMatchObject({ width: 42, height: 40 })
    for (const key of Object.keys(OUTLET_LOGOS)) {
      const logo = outletLogo([key])!
      expect(logo.width, key).toBeLessThanOrEqual(160)
      expect(logo.height, key).toBeLessThanOrEqual(40)
    }
  })
})
