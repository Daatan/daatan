const BARE_PREFIXES = ['/auth/', '/oracle-v2', '/home-v5']
const LOCALE_PREFIX = /^\/(he|ru|eo)(?=\/|$)/

/** Routes that render without the app Sidebar and its content margin. */
export function isBareChromePath(pathname: string): boolean {
  const path = pathname.replace(LOCALE_PREFIX, '') || '/'
  return BARE_PREFIXES.some((p) => path.startsWith(p))
}
