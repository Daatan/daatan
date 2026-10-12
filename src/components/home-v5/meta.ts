import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getAppUrl } from '@/lib/branding'

const PATH = '/home-v5'

function urlFor(locale: string): string {
  const base = getAppUrl()
  return locale === 'en' ? `${base}${PATH}` : `${base}/${locale}${PATH}`
}

export async function homeV5Metadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  const appUrl = getAppUrl()
  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    alternates: {
      canonical: urlFor(locale),
      languages: {
        'x-default': `${appUrl}${PATH}`,
        en: `${appUrl}${PATH}`,
        he: `${appUrl}/he${PATH}`,
        ru: `${appUrl}/ru${PATH}`,
      },
    },
    openGraph: { url: urlFor(locale), title: t('metaTitle'), description: t('metaDescription') },
  }
}
