import { isRtl } from '@/i18n/config'
import type { Locale } from '@/i18n/config'
import Capabilities from './Capabilities'
import ClosingCta from './ClosingCta'
import Footer from './Footer'
import Header from './Header'
import Hero from './Hero'
import TwoUses from './TwoUses'
import { buildLinks } from './links'

export default async function HomeV5({ locale }: { locale: Locale }) {
  const links = buildLinks(locale)
  // Real example cards arrive in stage 3 (#1840); without data the cards are not rendered.
  return (
    <div dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale} className="hv5 min-h-screen bg-[var(--hv5-bg)] font-sans text-[var(--hv5-ink)] antialiased">
      <Header locale={locale} links={links} />
      <div>
        <Hero locale={locale} links={links} />
        <TwoUses locale={locale} links={links} />
        <Capabilities locale={locale} />
        <ClosingCta locale={locale} links={links} />
      </div>
      <Footer locale={locale} links={links} />
    </div>
  )
}
