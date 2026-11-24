import { describe, it, expect } from 'vitest'
import { authorJsonLd } from '../author-json-ld'
import { isDaatanAccount } from '../daatan-account'

const appUrl = 'https://daatan.com'

describe('authorJsonLd (daatan#2301)', () => {
  it('describes a forecast published as Daatan as the site Organization, not a Person', () => {
    expect(authorJsonLd({ name: 'Daatan', username: 'daatan' }, appUrl)).toEqual({
      '@type': 'Organization',
      name: 'DAATAN',
      alternateName: 'דעתן',
      url: appUrl,
    })
  })

  it('keeps an ordinary author a Person linked to their profile', () => {
    expect(authorJsonLd({ name: 'Dana', username: 'dana' }, appUrl)).toEqual({
      '@type': 'Person',
      name: 'Dana',
      url: `${appUrl}/profile/dana`,
    })
  })

  it('falls back to the username when the author has no display name', () => {
    expect(authorJsonLd({ name: null, username: 'dana' }, appUrl)).toMatchObject({ '@type': 'Person', name: 'dana' })
  })
})

describe('isDaatanAccount', () => {
  it('matches only the reserved username', () => {
    expect(isDaatanAccount({ username: 'daatan' })).toBe(true)
    expect(isDaatanAccount({ username: 'daatan1' })).toBe(false)
    expect(isDaatanAccount({ username: null })).toBe(false)
    expect(isDaatanAccount({})).toBe(false)
  })
})
