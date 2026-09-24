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
    tag: 'CASE E01 · 910 RATED STATEMENTS',
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
    id: 'israel-2022',
    tag: 'CASE E02 · 1,100 RATED STATEMENTS',
    title: 'Who Saw 64 Seats Coming',
    description: "The six months before Israel's 25th Knesset election on 1 November 2022. Every statement was rated on how likely its speaker thought it was that Netanyahu's bloc would win a 61-seat majority. Polls gave the bloc 59–60 seats throughout the campaign, and the press leaned towards deadlock and a sixth election. The bloc won 64. P is the probability of a 61+ majority a speaker expressed, from 0 to 1.",
    reportHref: '/retroanalysis/israel-2022',
    leftColumn: {
      label: 'YES / 61+',
      outcome: 'CORRECT',
      sublabel: 'EXPECTED A NETANYAHU MAJORITY',
      color: 'teal',
      items: [
        { source: 'ALL ISRAEL NEWS', headline: 'Joel Rosenberg, editor-in-chief', date: 'Jul 09, 2022', quote: "If I were a betting man at one of Trump's casinos, I would probably put my money 60-40 on Netanyahu to come back." },
        { source: 'AL-QUDS AL-ARABI', headline: 'Nadav Eyal, Yedioth Ahronoth (translated)', date: 'Sep 18, 2022', quote: 'Since the start of the campaign, Netanyahu has not been closer to victory than he is now, thanks to Sami Abu Shehada and his colleagues, of course.' },
        { source: 'KIKAR HASHABBAT', headline: 'Amit Segal, Yedioth Ahronoth', date: 'Oct 14, 2022', quote: 'נתניהו, באופן תיאורטי, עשוי להגיע ל-63 מנדטים גם אם המחנה שלו יזכה לפחות ממחצית הקולות' },
        { source: 'AL-QUDS AL-ARABI', headline: 'Yuval Karni, Yedioth Ahronoth (translated)', date: 'Oct 28, 2022', quote: 'A 61-seat government headed by Netanyahu is the scenario with the highest likelihood of materializing.' },
      ]
    },
    rightColumn: {
      label: 'NO / DEADLOCK',
      outcome: 'WRONG',
      sublabel: 'EXPECTED NO MAJORITY',
      color: 'rose',
      items: [
        { source: 'ATLANTIC COUNCIL', headline: 'Noga Tarnopolsky', date: 'Jun 17, 2022', quote: 'Netanyahu has no evident path back...' },
        { source: 'CHANNEL 7 (RUSSIAN)', headline: 'Ze’ev Elkin, New Hope', date: 'Aug 29, 2022', quote: 'Нетаньяху почти ни в одном опросе не доходит до 61 мандата... Нетаньяху на этот раз не получит 61 место' },
        { source: 'AL-QUDS AL-ARABI', headline: 'Bobby Ghosh, Bloomberg (translated)', date: 'Oct 31, 2022', quote: 'The closest bet is holding a sixth election.' },
        { source: 'FOREIGN POLICY', headline: 'Shalom Lipner, Atlantic Council', date: 'Oct 31, 2022', quote: "Even more likely than this bleak scenario materializing is the correspondingly precarious outcome of Israelis being dragged to another sixth ballot in a few months' time." },
      ]
    }
  }
]
