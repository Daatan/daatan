import { slugify } from './slugify'

const MAX_SLUG_LENGTH = 50

// Russian + Ukrainian/Belarusian letters, lower case only (input is lowercased first).
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u',
}

/** 32-bit FNV-1a as 8 hex chars — sync and dependency-free, so it also runs client-side. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * URL slug for a tag name (daatan#1794). `slugify` keeps ASCII only, so every Hebrew or
 * Cyrillic tag used to become '' and all of them collapsed into whichever tag first took
 * that slug. Here:
 *   - ASCII names slugify exactly as before (existing slugs stay valid);
 *   - Latin diacritics are folded (café → cafe), Cyrillic is transliterated (Россия → rossiya);
 *   - anything still non-Latin (Hebrew, Arabic, CJK…) gets a stable `t-<hash>` of the name,
 *     as does a name with nothing sluggable left.
 */
export function tagSlug(name: string): string {
  const lower = name.normalize('NFKC').trim().toLowerCase()
  const latin = Array.from(lower, ch => CYRILLIC[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
  const hasOtherScript = /[^\x00-\x7f]/.test(latin.replace(/[^\p{L}\p{N}]/gu, ''))
  // Transliteration lengthens (щ → shch), and tags.slug is VarChar(50).
  const slug = hasOtherScript ? '' : slugify(latin).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  return /[a-z0-9]/.test(slug) ? slug : `t-${fnv1a(lower)}`
}
