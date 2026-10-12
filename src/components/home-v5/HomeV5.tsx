import { getTranslations } from 'next-intl/server'
import { isRtl } from '@/i18n/config'
import type { Locale } from '@/i18n/config'

export default async function HomeV5({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  return (
    <div dir={isRtl(locale) ? 'rtl' : 'ltr'} className="min-h-screen bg-[#001020] text-[#E6EDF5]">
      <section className="mx-auto max-w-[1240px] px-6 py-20 sm:px-12">
        <p className="mb-4 text-lg font-semibold text-[#7AA8DF]">{t('hero.eyebrow')}</p>
        <h1 className="mb-6 text-4xl font-extrabold leading-tight text-white sm:text-6xl">
          {t('hero.titleLine1')}
          <br />
          {t('hero.titleLine2')}
        </h1>
        <p className="max-w-[30em] text-xl leading-relaxed text-[#C3CDDA]">{t('hero.body')}</p>
      </section>
    </div>
  )
}
