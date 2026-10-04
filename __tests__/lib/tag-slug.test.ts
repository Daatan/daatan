import { describe, it, expect } from 'vitest'
import { tagSlug } from '@/lib/utils/tag-slug'
import { slugify } from '@/lib/utils/slugify'

describe('tagSlug', () => {
  it('leaves ASCII names exactly as slugify had them, so existing tag slugs stay valid', () => {
    for (const name of ['AI', 'Israeli Elections 2026', 'US-China trade', '  Crypto  ', 'snake_case tag', '2026']) {
      expect(tagSlug(name)).toBe(slugify(name))
    }
  })

  it('transliterates Cyrillic', () => {
    expect(tagSlug('Россия')).toBe('rossiya')
    expect(tagSlug('Ёжик в тумане')).toBe('yozhik-v-tumane')
    expect(tagSlug('Київ')).toBe('kiyiv')
  })

  it('keeps mixed Cyrillic + digits names apart', () => {
    expect(tagSlug('Россия 2026')).toBe('rossiya-2026')
    expect(tagSlug('Украина 2026')).toBe('ukraina-2026')
  })

  it('fits tags.slug VarChar(50) even when transliteration lengthens the name', () => {
    const name = 'Российско-украинские переговоры о прекращении огня'
    expect(name.length).toBeLessThanOrEqual(50)
    const slug = tagSlug(name)
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug).toMatch(/^rossiysko-ukrainskie-peregovory-o-prekrashchenii/)
    expect(slug).not.toMatch(/-$/)
    expect(tagSlug('Щщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщщ').length).toBe(50)
  })

  it('folds Latin diacritics instead of dropping the letter', () => {
    expect(tagSlug('Café résumé')).toBe('cafe-resume')
  })

  it('gives other scripts a stable, distinct hash slug — never empty', () => {
    const elections = tagSlug('בחירות')
    expect(elections).toMatch(/^t-[0-9a-f]{8}$/)
    expect(tagSlug(' בחירות ')).toBe(elections)
    expect(tagSlug('כלכלה')).not.toBe(elections)
    expect(tagSlug('בחירות 2026')).toMatch(/^t-[0-9a-f]{8}$/)
    expect(tagSlug('בחירות 2026')).not.toBe(tagSlug('כלכלה 2026'))
    expect(tagSlug('مصر')).toMatch(/^t-[0-9a-f]{8}$/)
  })

  it('hashes a name with nothing sluggable left', () => {
    expect(tagSlug('!!!')).toMatch(/^t-[0-9a-f]{8}$/)
  })
})
