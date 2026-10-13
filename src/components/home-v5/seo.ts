/**
 * Site-level structured data for the home-v5 page. It used to be emitted by the feed at "/", which
 * now redirects first-time visitors (and crawlers) here. SearchAction points at the forecasts
 * search the page header uses.
 */
export function buildSiteJsonLd(appUrl: string, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${appUrl}/#organization`, name: 'DAATAN', alternateName: 'דעתן', url: appUrl },
      {
        '@type': 'WebSite',
        '@id': `${appUrl}/#website`,
        name: 'DAATAN',
        alternateName: 'דעתן',
        url: appUrl,
        inLanguage: locale,
        publisher: { '@id': `${appUrl}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${appUrl}/forecasts?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }
}
