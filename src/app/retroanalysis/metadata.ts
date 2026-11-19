import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ogLocale } from '@/lib/og-locale'
import { retroHref, type RetroPath } from './links'

type RetroNamespace = 'retroIndex' | 'retroUkraine' | 'retroIsrael' | 'retroEnergy'

/**
 * /he, /ru and /eo pages pass their URL locale. English pages pass none and keep the
 * cookie/Accept-Language locale, as before. eo carries the English text and the [locale]
 * layout noindexes it, so it gets no hreflang entry.
 */
export async function retroMetadata(namespace: RetroNamespace, path: RetroPath, locale?: string): Promise<Metadata> {
  const ns = `${namespace}.meta` as const
  const t = locale ? await getTranslations({ locale, namespace: ns }) : await getTranslations(ns)
  const url = retroHref(locale ?? 'en', path)
  const isIndex = path === '/retroanalysis'
  return {
    // The case studies have always set the whole title; the index takes the root "%s | DAATAN" template.
    title: isIndex ? t('title') : { absolute: t('title') },
    description: t('description'),
    alternates: {
      canonical: url,
      languages: { 'x-default': path, en: path, he: retroHref('he', path), ru: retroHref('ru', path) },
    },
    openGraph: { url, type: isIndex ? 'website' : 'article', ...(locale ? { locale: ogLocale(locale) } : {}) },
  }
}
