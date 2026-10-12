import { describe, it, expect } from 'vitest'
import { isBareChromePath } from '../bare-chrome'

describe('isBareChromePath', () => {
  it.each(['/auth/signin', '/oracle-v2', '/home-v5', '/he/home-v5', '/ru/home-v5', '/eo/home-v5'])(
    'is bare: %s',
    (p) => expect(isBareChromePath(p)).toBe(true),
  )

  it.each(['/', '/he', '/about', '/he/about', '/forecasts', '/ru/forecasts/home-v5', '/hex/home-v5'])(
    'keeps chrome: %s',
    (p) => expect(isBareChromePath(p)).toBe(false),
  )
})
