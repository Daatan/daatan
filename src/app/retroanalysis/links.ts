// The he/ru/eo copies live under src/app/[locale]/retroanalysis (daatan#2249); English stays at the root.
export const RETRO_PATHS = [
  '/retroanalysis',
  '/retroanalysis/ukraine-2022',
  '/retroanalysis/israel-2022',
  '/retroanalysis/energy-2022',
] as const

export type RetroPath = (typeof RETRO_PATHS)[number]

export function retroHref(locale: string, href: string): string {
  return locale === 'en' ? href : `/${locale}${href}`
}
