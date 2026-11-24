import { isDaatanAccount } from '@/lib/daatan-account'

/**
 * schema.org author/creator/organizer node for a forecast's author. A forecast published
 * as Daatan (#2301) is authored by the site itself, so it is the same Organization as the
 * page's publisher, not a Person named "Daatan".
 */
export function authorJsonLd(
  author: { name: string | null; username: string | null },
  appUrl: string,
): Record<string, string | null> {
  if (isDaatanAccount(author)) {
    return { '@type': 'Organization', name: 'DAATAN', alternateName: 'דעתן', url: appUrl }
  }
  return {
    '@type': 'Person',
    name: author.name || author.username,
    url: `${appUrl}/profile/${author.username}`,
  }
}
