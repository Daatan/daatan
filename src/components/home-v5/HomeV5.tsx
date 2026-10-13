import { JsonLd } from '@/components/JsonLd'
import { getAppUrl } from '@/lib/branding'
import { isRtl } from '@/i18n/config'
import type { Locale } from '@/i18n/config'
import Capabilities from './Capabilities'
import ClosingCta from './ClosingCta'
import Footer from './Footer'
import Header from './Header'
import Hero from './Hero'
import TwoUses from './TwoUses'
import { getFeaturedForecast, getFeaturedSource } from './featured'
import { buildLinks } from './links'
import { buildSiteJsonLd } from './seo'

export default async function HomeV5({ locale }: { locale: Locale }) {
  const links = buildLinks(locale)
  const appUrl = getAppUrl()
  const siteJsonLd = buildSiteJsonLd(appUrl, locale)
  // Which examples are shown is configured in ./examples.ts; a card with no data is not rendered.
  const forecast = await getFeaturedForecast(locale)
  const source = getFeaturedSource(locale)
  return (
    <div dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale} className="hv5 min-h-screen bg-[var(--hv5-bg)] font-sans text-[var(--hv5-ink)] antialiased">
      <JsonLd data={siteJsonLd} />
      <Header locale={locale} links={links} />
      <div>
        <Hero locale={locale} links={links} />
        <TwoUses locale={locale} links={links} forecast={forecast} source={source} />
        <Capabilities locale={locale} />
        <ClosingCta locale={locale} links={links} />
      </div>
      <Footer locale={locale} links={links} />
    </div>
  )
}
