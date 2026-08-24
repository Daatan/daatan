import type { Metadata } from 'next'
import { Mail, Github, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import { getAppUrl, getContactEmail } from '@/lib/branding'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })
  const appUrl = getAppUrl()
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: {
      canonical: `${appUrl}/${locale}/contact`,
      languages: {
        'x-default': `${appUrl}/contact`,
        en: `${appUrl}/contact`,
        he: `${appUrl}/he/contact`,
        ru: `${appUrl}/ru/contact`,
      },
    },
    openGraph: { url: `${appUrl}/${locale}/contact`, type: 'website' },
  }
}

export default async function LocaleContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  // SaaS-only support page (DAATAN contact details) — absent on self-host, same as /contact.
  if (isSelfHosted()) notFound()
  const t = await getTranslations({ locale, namespace: 'contact' })
  const contactEmail = getContactEmail()

  return (
    <div dir={locale === 'he' ? 'rtl' : 'ltr'} className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>

      <div className="bg-navy-800 border border-cobalt/30 rounded-xl p-6 mb-6">
        <p className="text-sm text-text-secondary">{t('intro')}</p>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">{t('getInTouch')}</h2>
        </div>
        <div className="p-6 space-y-4">
          <a
            href={`mailto:${contactEmail}`}
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-blue-900/30 text-blue-400 rounded-lg shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">{t('email')}</p>
              <p className="text-sm text-cobalt-light">{contactEmail}</p>
            </div>
          </a>

          <a
            href="https://github.com/Daatan/daatan/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-navy-700 text-text-secondary rounded-lg shrink-0">
              <Github className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">{t('githubIssues')}</p>
              <p className="text-sm text-text-secondary">{t('githubIssuesDesc')}</p>
            </div>
          </a>

          <a
            href="https://x.com/daatan_dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-navy-700 text-text-secondary rounded-lg shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">{t('twitter')}</p>
              <p className="text-sm text-text-secondary">@daatan_dev</p>
            </div>
          </a>
        </div>
      </div>

      <div className="text-center text-sm text-text-subtle">
        <Link href={`/${locale}/about`} className="hover:text-white hover:underline">
          {t('learnMore')}
        </Link>
      </div>
    </div>
  )
}
