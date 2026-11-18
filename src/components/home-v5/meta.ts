import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getAppName, getAppUrl } from '@/lib/branding'
import { ogLocale } from '@/lib/og-locale'
import { alt as SHARE_IMAGE_ALT } from '@/app/opengraph-image'

// The root serves this page in place (src/lib/first-visit.ts), so it canonicalizes to the root;
// /home itself folds onto it (daatan#2057).
function urlFor(locale: string): string {
  const base = getAppUrl()
  return locale === 'en' ? base : `${base}/${locale}`
}

export async function homeV5Metadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  const appUrl = getAppUrl()
  const SHARE_IMAGE = `${appUrl}/opengraph-image`
  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    alternates: {
      canonical: urlFor(locale),
      languages: {
        'x-default': appUrl,
        en: appUrl,
        he: `${appUrl}/he`,
        ru: `${appUrl}/ru`,
      },
    },
    // Setting openGraph here replaces the inherited one, so the share image is declared explicitly.
    openGraph: {
      url: urlFor(locale),
      title: t('metaTitle'),
      description: t('metaDescription'),
      type: 'website',
      siteName: getAppName(),
      locale: ogLocale(locale),
      images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: SHARE_IMAGE_ALT }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('metaTitle'),
      description: t('metaDescription'),
      images: [SHARE_IMAGE],
    },
  }
}
