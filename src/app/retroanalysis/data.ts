export interface NewsItem {
  source: string
  headline: string
  date: string
  quote?: string
}

export interface AnalysisSection {
  title: string
  content: string[]
}

export interface AnalysisData {
  id: string
  tag: string
  title: string
  description: string
  leftColumn: {
    label: string
    outcome: string
    sublabel: string
    color: string
    items: NewsItem[]
  }
  rightColumn: {
    label: string
    outcome: string
    sublabel: string
    color: string
    items: NewsItem[]
  }
  detailedAnalysis?: AnalysisSection[]
  citations?: string[]
  reportHref?: string
}

export const analyses: AnalysisData[] = [
  {
    id: 'ukraine-2022',
    tag: 'CASE E01 · 913 RATED STATEMENTS',
    title: 'Who Saw the Invasion of Ukraine Coming',
    description: "The three months before Russia's full-scale invasion on 24 February 2022. Every statement was rated on how likely its speaker thought a full-scale invasion was, on the day it was published. Western governments averaged 80%. Russian officials said no in 80% of their statements, and Ukrainian officials in 40%. P is the invasion probability a speaker expressed, from 0 to 1.",
    reportHref: '/retroanalysis/ukraine-2022',
    leftColumn: {
      label: 'YES / INVASION',
      outcome: 'CORRECT',
      sublabel: 'EXPECTED A FULL-SCALE INVASION',
      color: 'teal',
      items: [
        { source: 'INTERFAX', headline: 'Kyrylo Budanov, head of Ukrainian military intelligence', date: 'Nov 21, 2021', quote: 'Россия сосредоточила у границ Украины более 92 тыс. военнослужащих и готовится к нападению в конце января или начале февраля 2022 года.' },
        { source: 'THE WASHINGTON POST', headline: "Rob Lee, King's College London", date: 'Jan 21, 2022', quote: 'A Russian military operation against Ukraine is more likely than not, in part because of the unprecedented scale of the Russian military buildup underway around the country.' },
        { source: 'THE NEW YORK TIMES', headline: 'Joe Biden, US President', date: 'Feb 02, 2022', quote: 'My guess is he will move in. He has to do something.' },
        { source: 'PBS NEWSHOUR', headline: 'Jonathan Finer, US Deputy National Security Adviser', date: 'Feb 04, 2022', quote: "Whatever Russian officials are saying in public about their intentions, we have to take that with a grain of salt because of what we're actually seeing with our own eyes." },
      ]
    },
    rightColumn: {
      label: 'NO / BLUFF',
      outcome: 'WRONG',
      sublabel: 'DISMISSED A FULL-SCALE INVASION',
      color: 'rose',
      items: [
        { source: 'IZVESTIA', headline: 'Dmitry Peskov, Kremlin spokesman', date: 'Nov 29, 2021', quote: 'Слова о якобы планируемом Россией нападении абсолютно беспочвенны.' },
        { source: 'INSTITUTE FOR THE STUDY OF WAR', headline: "Putin's Likely Courses of Action in Ukraine, Part 2", date: 'Dec 12, 2021', quote: 'Putin does not, in fact, intend to invade unoccupied Ukraine this winter despite the continued build-up of Russian forces in preparation to do so.' },
        { source: 'UNIAN', headline: "Oleksiy Danilov, Secretary of Ukraine's Security Council", date: 'Dec 30, 2021', quote: 'Сейчас угрозы открытой агрессии Российской Федерации против Украины не наблюдается… Поэтому отдыхайте спокойно, празднуйте.' },
        { source: 'CARNEGIE MOSCOW CENTER', headline: 'Are We On the Brink of War? An Interview With Dmitri Trenin', date: 'Jan 20, 2022', quote: 'In the immediate future, say, the coming month, I think the answer is no.' },
        { source: 'FOREIGN POLICY', headline: 'Jeff Hawn, London School of Economics', date: 'Jan 24, 2022', quote: 'While a full-scale invasion across Ukraine remains highly unlikely, there are a range of other options open to Russia.' },
      ]
    }
  },
  {
    id: 'maduro-extraction',
    tag: 'POLITICAL FORECAST MARKET #882-VZ',
    title: 'U.S. Military Extraction of Maduro',
    description: 'Media Sentiment Analysis: 14 Days Preceding the Jan 2026 Operation. Hover over sources to view verified predictive quotes.',
    leftColumn: {
      label: 'YES / ACTION',
      outcome: 'SUCCESS',
      sublabel: 'ACCURATE ANALYTICAL FORECASTS',
      color: 'teal',
      items: [
        { source: 'THE WALL STREET JOURNAL', headline: "Pentagon Weighs 'Kinetic Options' as Caracas Deadlock Hardens", date: 'Dec 29, 2025' },
        { source: 'X - @SENTINELS_INTEL (OSINT)', headline: 'Unusual C-17 Activity at Guantanamo Bay', date: 'Jan 03, 2026' },
        { source: 'MIAMI HERALD', headline: "White House Sources: 'Patience has Run Out' on Venezuela", date: 'Jan 05, 2026' },
        { source: 'PANAM POST', headline: 'The Capture is the Only Way Out', date: 'Dec 30, 2025' },
        { source: 'FOREIGN POLICY', headline: 'The End of Diplomacy in the Caribbean', date: 'Jan 02, 2026' },
        { source: 'INFOBAE', headline: 'Navy Seals Training in Colombia?', date: 'Jan 04, 2026' },
      ]
    },
    rightColumn: {
      label: 'NO / DIPLOMACY',
      outcome: 'FAILED',
      sublabel: 'INACCURATE / DISMISSIVE FORECASTS',
      color: 'rose',
      items: [
        { source: 'THE NEW YORK TIMES', headline: 'Why Military Intervention in Venezuela is Off the Table', date: 'Dec 29, 2025' },
        { source: 'AL JAZEERA ENGLISH', headline: 'Regional Powers Rule Out Force', date: 'Jan 02, 2026' },
        { source: 'THE GUARDIAN', headline: "Maduro's Grip Tightens Amid U.S. Indecision", date: 'Jan 04, 2026' },
        { source: 'VENEZUELANALYSIS', headline: 'Invasion Rumors are Psychological Warfare', date: 'Dec 31, 2025' },
        { source: 'THE WASHINGTON POST', headline: 'Editorial: Stick to the Sanctions', date: 'Jan 03, 2026' },
        { source: 'REUTERS', headline: 'Backchannel Talks Continue in Barbados', date: 'Jan 05, 2026', quote: '"Diplomats from both sides report \'significant progress\' on an exit roadmap. The threat of force has been effectively sidelined by these productive negotiations."' },
      ]
    }
  },
  {
    id: 'trump-wars',
    tag: 'POLITICAL FORECAST MARKET #2025-WAR-WATCH',
    title: 'Trump’s ‘No New Wars’ Pledge: A Predictive Sentiment Analysis',
    description: "During the first year of the second Trump administration, global media and political analysts were sharply divided over the president's 'America First' promise to avoid foreign entanglements. While supporters and some polling data pointed to a successful shift toward isolationist peacemaking, critics and regional experts warned that a new 'imperialist' doctrine was being codified in the 2025 National Security Strategy.",
    leftColumn: {
      label: 'YES / PEACE',
      outcome: 'NO NEW WARS',
      sublabel: 'PREDICTED OUTCOME (ISOLATIONISM)',
      color: 'teal',
      items: [
        { source: 'GALLUP', headline: '"Biggest change since 2016 is increased belief Trump will avoid war" (55% public confidence).', date: 'Jan 02, 2025' },
        { source: 'WALL STREET JOURNAL', headline: '"Trump\'s Best Foreign Policy? Not Starting Any Wars." — Endorsement by JD Vance.', date: 'Jan 31, 2023/Ref\'d 2025' },
        { source: 'PRESIDENTIAL INAUGURAL', headline: '"My proudest legacy will be that of a peacemaker... the wars we never get into."', date: 'Jan 20, 2025' },
        { source: 'DEFENSE SECRETARY HEGSETH', headline: '"The War Department will not be distracted by democracy-building... regime change."', date: 'Dec 06, 2025' },
        { source: 'JAPAN FORWARD', headline: '"First Trump Administration... started no new wars — second will be even more effective."', date: 'Jan 01, 2025' },
      ]
    },
    rightColumn: {
      label: 'NO / INTERVENTION',
      outcome: 'ESCALATION / WAR',
      sublabel: 'PREDICTED OUTCOME (DOMINANCE)',
      color: 'rose',
      items: [
        { source: 'THE NEW YORK TIMES', headline: '"Trump\'s increasing willingness to deploy military force underscores the broader change."', date: 'Oct 10, 2025' },
        { source: 'ASSOCIATED PRESS', headline: '"President-elect has been embracing a new imperialist agenda... by military force."', date: 'Jan 09, 2025' },
        { source: 'RESPONSIBLE STATECRAFT', headline: '"Reckless escalation with Venezuela... interdiction of vessels constitutes an act of war."', date: 'Sep 15, 2025' },
        { source: 'FOREIGN POLICY', headline: '"Trump’s new national security strategy goes full ‘America First’... portends substantial changes."', date: 'Dec 10, 2025' },
        { source: 'QUINCY INSTITUTE', headline: '"Revival of the Monroe Doctrine... portends a new age of militaristic interventionism."', date: 'Dec 04, 2025' },
      ]
    },
    detailedAnalysis: [
      {
        title: 'The Case for Peace: Selective Engagement and Strategic Withdrawal',
        content: [
          'Public and Political Confidence: By the start of 2025, 55% of Americans believed Trump would keep the nation out of war, a 17-point increase since his first term. Vice President JD Vance’s foundational endorsement was built on the premise that Trump would not "recklessly send Americans to fight overseas".',
          'The "SCOPE" Strategy: Under Defense Secretary Pete Hegseth, the administration developed the "SCOPE" strategy, aimed at reducing troop numbers in the Middle East and shifting to "burden and risk sharing" with regional allies.',
          'Negotiation-First Rhetoric: In the early months, Trump touted his ability to end the Russia-Ukraine war and brokered a significant ceasefire and hostage-release deal between Israel and Hamas in October 2025, reinforcing his "peacemaker" image.'
        ]
      },
      {
        title: 'The Case for Intervention: The "Donroe Doctrine" and Hemispheric Dominance',
        content: [
          'Imperialist Ambitions: Analysts flagged Trump’s early threats to seize the Panama Canal and Greenland as a departure from traditional norms. By September 2025, Trump had already deployed 10% of the U.S. Navy fleet to the Caribbean.',
          'The 2025 National Security Strategy (NSS): Published on December 4, 2025, the NSS codified the "Trump Corollary" to the Monroe Doctrine (often referred to as the "Donroe Doctrine"). It explicitly prioritized U.S. objectives in the Western Hemisphere over all other regions and signaled a willingness to use force to ensure hemispheric dominance.',
          'Incremental Military Action: Before the major Caracas operation, the U.S. conducted 35 strikes against drug-trafficking vessels in late 2025, resulting in 115 deaths. This "unrestrained" executive power was viewed by legal scholars as a precursor to full-scale intervention.'
        ]
      },
      {
        title: 'Historical Signposts for the Transition to War',
        content: [
          'Staffing for Action: Unlike his first term, Trump entered 2025 with a team of "loyalists" who viewed their jobs as facilitating the president’s impulses rather than acting as "adults in the room" to restrain him.',
          'Strategic Disengagement vs. Aggression: While Trump sought to disengage from European and North Asian alliances, he simultaneously "authorized attacks in eight nations" within his first year, approving more airstrikes in 2025 than his predecessor did in four years.'
        ]
      }
    ]
  },
  {
    id: 'energy-volatility-2026',
    tag: 'ENERGY FORECAST MARKET #Q1-2026-OIL',
    title: 'Geopolitical Convergence and the Energy Volatility of 2026: A Multi-Media Sentiment Analysis',
    description: 'The global energy market in the first quarter of 2026 has been thrust into a state of profound dislocation. This analysis synthesizes predictions from thirty major media outlets and financial institutions, filtered for clear sentiment regarding the trajectory of crude oil prices.',
    leftColumn: {
      label: 'BULLISH / SUPPLY SHOCK',
      outcome: '$100 - $150 BBL',
      sublabel: 'PREDICTED OUTCOME (SHOCK)',
      color: 'teal',
      items: [
        { source: 'LITEFINANCE', headline: '"Buying Brent with targets at $125 and $130 remains relevant."', date: 'Mar 09, 2026' },
        { source: 'KPLER', headline: '"Sees a potential range of $130–150."', date: 'Mar 09, 2026' },
        { source: 'J.P. MORGAN', headline: '"Unprecedented disruption... potentially surging oil prices to $120."', date: 'Mar 06, 2026' },
        { source: 'GOLDMAN SACHS', headline: '"Brent prices would likely reach $100" if disruption lasts 5 weeks.', date: 'Mar 06, 2026' },
        { source: 'OCBC GROUP', headline: '"Expects prices to reach $140 per barrel."', date: 'Mar 09, 2026' },
        { source: 'WOOD MACKENZIE', headline: '"Failure to re-establish flows... drive Brent prices well over $100."', date: 'Mar 02, 2026' },
      ]
    },
    rightColumn: {
      label: 'BEARISH / STRUCTURAL SURPLUS',
      outcome: '$50 - $65 BBL',
      sublabel: 'PREDICTED OUTCOME (STABILITY)',
      color: 'rose',
      items: [
        { source: 'SBI RESEARCH', headline: '"Crude prices to soften... touch $50/barrel by June."', date: 'Jan 05, 2026' },
        { source: 'U.S. EIA', headline: '"Brent crude spot prices to average $57.69 per barrel in 2026."', date: 'Feb 10, 2026' },
        { source: 'BLOOMBERGNEF', headline: '"Estimates Brent crude to average $55 per barrel in 2026."', date: 'Jan 13, 2026' },
        { source: 'REUTERS POLL', headline: '"Consensus estimate that Brent would average $63.85."', date: 'Feb 27, 2026' },
        { source: 'WOOD MACKENZIE', headline: '"Incremental barrels... driving Brent below mid- to high-US$50/bbl."', date: 'Jan 06, 2026' },
        { source: 'J.P. MORGAN (BASELINE)', headline: '"Brent crude averaging around $60/bbl in 2026."', date: 'Feb 27, 2026' },
      ]
    },
    citations: [
      "Oil Can Hit $91 a Barrel in Late 2026 on Iran Disruption | BloombergNEF, accessed March 9, 2026, https://about.bnef.com/insights/commodities/oil-can-hit-91-a-barrel-in-late-2026-on-iran-disruption/",
      "Venezuela is back in the oil game at a critical moment, accessed March 9, 2026, https://www.thestreet.com/markets/venezuela-is-back-in-the-oil-game-at-a-critical-moment",
      "What Does the Iran War Mean for Global Energy Markets? - CSIS, accessed March 9, 2026, https://www.csis.org/analysis/what-does-iran-war-mean-global-energy-markets",
      "Oil Market Expectations Following the Venezuelan Intervention - TD Securities, accessed March 9, 2026, https://www.tdsecurities.com/ca/en/venezuela-intervention-oil-expectations",
      "Oil Sounds the Alarm. Forecast as of 09.03.2026 | LiteFinance, accessed March 9, 2026, https://www.litefinance.org/blog/analysts-opinions/oil-price-prediction-forecast/oil-sounds-the-alarm-forecast-as-of-09032026/",
      "Crude oil prices surpass $100 a barrel as the Iran war impedes production and shipping, accessed March 9, 2026, https://www.barchart.com/story/news/632447/crude-oil-prices-surpass-100-a-barrel-as-the-iran-war-impedes-production-and-shipping",
      "Goldman Sachs' Contrarian Bullish Logic: The Strait of Hormuz Will Resume Passage in 5 Days, 70% Recovery in 2 Weeks, 100% Recovery in 4 Weeks | Bitget News, accessed March 9, 2026, https://www.bitget.com/news/detail/12560605239482",
      "Oil jumps above $105 on Middle East tensions, supply fears - Anadolu Ajansı, accessed March 9, 2026, https://www.aa.com.tr/en/energy/oil/oil-jumps-above-105-on-middle-east-tensions-supply-fears/55292",
      "Crude Oil Surge: Why Geopolitical Tensions in Iran are Driving Price ..., accessed March 9, 2026, https://www.devere-group.com/analysts-hike-oil-price-forecast-on-iran-war-news/",
      "Venezuela Regime Change: Impact on Oil ... - Wood Mackenzie, accessed March 9, 2026, https://www.woodmac.com/news/opinion/venezuela-regime-change-what-it-means-for-oil-production-crude-and-product-markets/",
      "World shares tumble as Iran war pushes crude prices over $110 a barrel - Barchart.com, accessed March 9, 2026, https://www.barchart.com/story/news/633066/world-shares-tumble-as-iran-war-pushes-crude-prices-over-110-a-barrel",
      "Global oil supply chains face historic stress: Crude prices and tanker rates now at all-time highs — here’, accessed March 9, 2026, https://m.economictimes.com/news/international/us/global-oil-supply-chains-face-historic-stress-crude-prices-and-tanker-rates-now-at-all-time-highs-heres-the-key-reason-behind-the-oil-price-surge/articleshow/129107376.cms",
      "Oil Forecast and Price Predictions 2026 - NAGA, accessed March 9, 2026, https://naga.com/en/news-and-analysis/articles/oil-price-prediction",
      "Crude Prices to Soften in 2026, Touch $50/Barrel by Jun: Report - Outlook Business, accessed March 9, 2026, https://www.outlookbusiness.com/news/crude-prices-to-soften-in-2026-touch-50barrel-by-jun-report",
      "Oil Price Forecast for 2026 | J.P. Morgan Global Research, accessed March 9, 2026, https://www.jpmorgan.com/insights/global-research/commodities/oil-prices",
      "Crude Oil Forecast 2026: Will Prices Rise or Fall?, accessed March 9, 2026, https://www.ebc.com/forex/crude-oil-forecast-2026-will-prices-rise-or-fall",
      "Spiking oil prices basically end any chance of a market 'melt-up,' says this Wall Street veteran | Morningstar, accessed March 9, 2026, https://www.morningstar.com/news/marketwatch/2026030951/spiking-oil-prices-basically-end-any-chance-of-a-market-melt-up-says-this-wall-street-veteran",
      "White House worries as gas prices jump amid ongoing US-Israel war on Iran, accessed March 9, 2026, https://www.theguardian.com/world/2026/mar/08/us-drivers-oil-prices-iran",
      "Chevron's Oil Exports Surge Amid Geopolitical Tensions, accessed March 9, 2026, https://intellectia.ai/news/monitor/chevrons-oil-exports-surge-amid-geopolitical-tensions",
      "Venezuela Resumes Oil Exports Amid Geopolitical Tensions, accessed March 9, 2026, https://intellectia.ai/news/stock/venezuela-resumes-oil-exports-amid-geopolitical-tensions",
      "Venezuela: Impact on Oil and LNG Markets | J.P. Morgan, accessed March 9, 2026, https://www.jpmorgan.com/insights/global-research/commodities/venezuela-oil-lng",
      "Philippines – Strait of Hormuz closure: Impact of higher oil prices and more, accessed March 9, 2026, https://www.mufgresearch.com/fx/philippines-strait-of-hormuz-closure-impact-of-higher-oil-prices-and-more-9-march-2026/",
      "Oil prices are the No. 1 thing investors are watching right now ..., accessed March 9, 2026, https://www.morningstar.com/news/marketwatch/2026030965/oil-prices-are-the-no-1-thing-investors-are-watching-right-now-heres-why",
      "Index Market Analysis – March 2, 2026 | Operation Epic Fury & Market Shockwaves, accessed March 9, 2026, https://www.capitalstreetfx.com/index-market-analysis-march-2-2026-operation-epic-fury-market-shockwaves/",
      "HSG perspectives on the war in Iran and the Middle East - University of St.Gallen, accessed March 9, 2026, https://www.unisg.ch/en/newsdetail/news/hsg-perspectives-on-the-war-in-iran-and-the-middle-east/",
      "My Trading Game Game Plan Revealed - 03/03/2026: Geopolitical Shock Tests S - Verified Investing, accessed March 9, 2026, https://verifiedinvesting.com/blogs/live-show-recap/my-trading-game-plan-revealed-03-03-2026-geopolitical-shock-tests-s-p-500-support-as-oil-and-yields-surge",
      "Forex Today: WTI Crude Oil $78 as Hormuz Traffic Stays Stopp, accessed March 9, 2026, https://www.dailyforex.com/forex-news/2026/03/forex-today-05-march-2026/242106",
      "US shale offers no quick remedy to Iran war price spike, accessed March 9, 2026, https://www.argusmedia.com/news-and-insights/latest-market-news/2798308-us-shale-offers-no-quick-remedy-to-iran-war-price-spike"
    ]
  }
]
