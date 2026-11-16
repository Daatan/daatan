import { describe, it, expect } from 'vitest'
import { isBareChromePath } from '../bare-chrome'

describe('isBareChromePath', () => {
  it.each(['/auth/signin', '/oracle-v2', '/home', '/he/home', '/ru/home', '/eo/home'])(
    'is bare: %s',
    (p) => expect(isBareChromePath(p)).toBe(true),
  )

  it.each(['/', '/he', '/about', '/he/about', '/forecasts', '/ru/forecasts/home', '/hex/home'])(
    'keeps chrome: %s',
    (p) => expect(isBareChromePath(p)).toBe(false),
  )
})
