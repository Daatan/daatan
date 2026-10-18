// Display text for each case (tag, title, description, column labels, headlines, quotes)
// lives in messages/*.json under `retroIndex.cases.<id>`; this file holds the language-neutral part.
export interface NewsItem {
  source: string
  /** ISO date (UTC), formatted per locale on render. */
  date: string
}

export interface AnalysisData {
  id: string
  reportHref: string
  leftItems: NewsItem[]
  rightItems: NewsItem[]
}

export const analyses: AnalysisData[] = [
  {
    id: 'ukraine-2022',
    reportHref: '/retroanalysis/ukraine-2022',
    leftItems: [
      { source: 'INTERFAX', date: '2021-11-21' },
      { source: 'THE WASHINGTON POST', date: '2022-01-21' },
      { source: 'THE NEW YORK TIMES', date: '2022-02-02' },
      { source: 'PBS NEWSHOUR', date: '2022-02-04' },
    ],
    rightItems: [
      { source: 'IZVESTIA', date: '2021-11-29' },
      { source: 'INSTITUTE FOR THE STUDY OF WAR', date: '2021-12-12' },
      { source: 'UNIAN', date: '2021-12-30' },
      { source: 'CARNEGIE MOSCOW CENTER', date: '2022-01-20' },
      { source: 'FOREIGN POLICY', date: '2022-01-24' },
    ],
  },
  {
    id: 'israel-2022',
    reportHref: '/retroanalysis/israel-2022',
    leftItems: [
      { source: 'ALL ISRAEL NEWS', date: '2022-07-09' },
      { source: 'AL-QUDS AL-ARABI', date: '2022-09-18' },
      { source: 'KIKAR HASHABBAT', date: '2022-10-14' },
      { source: 'AL-QUDS AL-ARABI', date: '2022-10-28' },
    ],
    rightItems: [
      { source: 'ATLANTIC COUNCIL', date: '2022-06-17' },
      { source: 'CHANNEL 7 (RUSSIAN)', date: '2022-08-29' },
      { source: 'AL-QUDS AL-ARABI', date: '2022-10-31' },
      { source: 'FOREIGN POLICY', date: '2022-10-31' },
    ],
  },
  {
    id: 'energy-2022',
    reportHref: '/retroanalysis/energy-2022',
    leftItems: [
      { source: 'BUSINESS INSIDER', date: '2022-01-21' },
      { source: 'NPR', date: '2022-02-22' },
      { source: 'ROSSIYSKAYA GAZETA', date: '2021-09-17' },
      { source: 'OILPRICE', date: '2022-01-25' },
    ],
    rightItems: [
      { source: 'VEDOMOSTI', date: '2021-12-01' },
      { source: 'EIA', date: '2022-01-12' },
      { source: 'FXSTREET', date: '2022-01-27' },
      { source: 'TASS', date: '2021-09-07' },
    ],
  },
]
