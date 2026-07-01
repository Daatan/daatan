import { describe, it, expect } from 'vitest'
import { jsonLdSafe } from '../jsonLd'

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

describe('jsonLdSafe', () => {
  it('neutralizes a </script> breakout payload', () => {
    const out = jsonLdSafe({ name: '</script><script>alert(document.cookie)</script>' })
    // No literal tag delimiters survive, so the HTML parser cannot end the
    // <script> element early or open a new one.
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<script>')
    expect(out).not.toMatch(/[<>]/)
    expect(out).toContain('\\u003c/script\\u003e')
  })

  it('escapes <, >, & everywhere', () => {
    const out = jsonLdSafe({ a: '<', b: '>', c: '&' })
    expect(out).not.toMatch(/[<>&]/)
    expect(out).toContain('\\u003c')
    expect(out).toContain('\\u003e')
    expect(out).toContain('\\u0026')
  })

  it('escapes the U+2028 / U+2029 line separators', () => {
    const out = jsonLdSafe({ x: `a${LS}b${PS}c` })
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(out).not.toContain(LS)
    expect(out).not.toContain(PS)
  })

  it('stays semantically identical JSON (round-trips through JSON.parse)', () => {
    const obj = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Will X happen? </script> & <b>bold</b>',
      nested: { arr: [1, 2, '>'], u: `line${LS}sep${PS}end` },
    }
    expect(JSON.parse(jsonLdSafe(obj))).toEqual(obj)
  })
})
