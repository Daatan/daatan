/**
 * next/image optimizes relative paths and the hosts in `images.remotePatterns` (next.config.js);
 * for any other absolute URL `/_next/image` answers 400. The Daatan account's avatar is stored as
 * an absolute URL on this site, because its profile OG image and JSON-LD need one (#2301), so an
 * avatar on this site is served by path (#2362).
 */
export function toAvatarSrc(src: string, appUrl: string): string {
  return src.startsWith(`${appUrl}/`) ? src.slice(appUrl.length) : src
}
