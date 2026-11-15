import { describe, expect, it } from 'vitest'
import { ClaimArchetype } from '@prisma/client'
import { parseQuestionQuantity, questionQuantityParam, type QuestionQuantity } from '../question-quantity'

// Golden fixture: every prod THRESHOLD-archetype question as of 2026-11-14 (43),
// verbatim, each with the bar it must parse to or the reason it must not
// (daatan#2176). Precision over recall: a wrong bar makes retro's rule 2 report
// contradictions the claim does not contain, and a null only makes it abstain.
type Case = [string, QuestionQuantity | string]
const PROD: Case[] = [
  ["A 32GB DDR5-6000 memory kit will cost over $450 in Tom's Hardware RAM Price Index by December 31, 2026.", { comparator: '>', value: 450, unit: 'USD' }],
  ['At least three Israeli chess players will appear in the FIDE Top 100 rankings at any point during 2027.', { comparator: '>=', value: 3, unit: 'Israeli chess players' }],
  ['The Shekel will be stronger against the US Dollar one week after the elections in Israel.', 'no_bar'],
  ['At least one Scandinavian country will be home cashless by December 31, 2029.', { comparator: '>=', value: 1, unit: 'Scandinavian country' }],
  ['The Portland Trail Blazers will finish the 2026/27 NBA regular season among the top six teams in the Western Conference and qualify directly for the playoffs by April 11, 2027.', 'no_bar'],
  ['At least 4 of the seven Millennium Prize Problems in mathematics will be officially recognized as solved by December 31, 2026.', 'k_of_n'],
  ['The voter turnout in the upcoming Knesset elections will reach at least 73%.', { comparator: '>=', value: 73, unit: 'percent' }],
  ['The number of immigrants to Israel will exceed 25,000 in the year 5787.', 'no_unit'],
  ['The number of Israelis emigrating abroad will be higher in the 12 months following the next general elections in Israel than in the 12 months preceding them, by September 9, 2031.', 'no_bar'],
  ['Am Yisrael will not pass the electoral threshold in the next general elections for the Knesset by December 31, 2026.', 'no_bar'],
  ['Cultivated meat will comprise more than 50% of global meat consumption by weight by December 31, 2056.', { comparator: '>', value: 50, unit: 'percent' }],
  ["JPMorgan Chase's market capitalization will exceed $1 trillion by January 1, 2027.", { comparator: '>', value: 1, unit: 'trillion USD' }],
  ['Chess.com will have more than 500,000,000 registered users by December 31, 2030.', { comparator: '>', value: 500_000_000, unit: 'registered users' }],
  ['Most children aged 6-18 in all Western countries will be educated through home learning, using artificial intelligence, by August 27, 2036.', 'no_bar'],
  ['The global fertility rate in 2050 will be less than 2 children per woman.', { comparator: '<', value: 2, unit: 'children per woman' }],
  ['By August 18, 2026, the Yeshar Party will lead Likud in at least two different national mandate polls, and in at least one of these polls, the lead will be two mandates or more.', 'multiple_bars'],
  ['The annual inflation rate in the US, as published on August 12, 2026, will be 3.4% or higher.', { comparator: '>=', value: 3.4, unit: 'percent' }],
  ['The U.S. unemployment rate for August 2026 comes in at 4.2% or higher.', { comparator: '>=', value: 4.2, unit: 'percent' }],
  ['Brent crude oil price will cross the $100 per barrel mark at least once by December 31, 2026.', { comparator: '>=', value: 100, unit: 'USD per barrel' }],
  ['Maritime traffic through the Strait of Hormuz will return to pre-conflict normal levels by September 30, 2026.', 'no_bar'],
  ['The housing price index in Israel will be higher on December 31, 2026, than it was on December 31, 2025.', 'no_bar'],
  ['Lionel Messi will score at least 8 goals in the 2026 FIFA World Cup before the tournament concludes.', { comparator: '>=', value: 8, unit: 'goals' }],
  ['Mark Zuckerberg will achieve a net worth of $1 trillion by December 31, 2026.', 'no_bar'],
  ['The Commodore Callback 8020 flip phone will sell more than 100,000 units globally by December 31, 2027.', { comparator: '>', value: 100_000, unit: 'units' }],
  ['DAATAN will be a well-known brand in Israel, comparable to or exceeding Wix\'s brand recognition, by December 31, 2027.', 'no_bar'],
  ['ChatGPT will be the most commonly used AI tool worldwide, including for code writing, by June 9, 2028', 'no_bar'],
  ['Ariel Galili will earn 30,000 shekels by December 31, 2026.', 'no_bar'],
  ['The price of Brent crude oil will reach or exceed $130 per barrel on the Intercontinental Exchange (ICE) before December 31, 2026.', { comparator: '>=', value: 130, unit: 'USD per barrel' }],
  ["The Netflix documentary 'Untold: Chess Mates' will have a Tomatometer score of 70% or higher on Rotten Tomatoes by July 31, 2026.", { comparator: '>=', value: 70, unit: 'percent' }],
  ['Yağız Kaan Erdoğmuş will become one of the top 10 ranked chess players in the world by December 31, 2026.', 'no_bar'],
  ['The Russian economy will experience a larger budget deficit as a percentage of GDP in 2026 compared to 2025, as reported by March 31, 2027.', 'no_bar'],
  ['A publicly reported congress or conference held in Israel will have exactly 50 participants by December 31, 2026.', { comparator: '=', value: 50, unit: 'participants' }],
  ['Esperanto Wikipedia will have more than 400,000 articles by December 31, 2026.', { comparator: '>', value: 400_000, unit: 'articles' }],
  ['Javokhir Sindarov will reach a FIDE standard rating of 2800 by December 31, 2026.', 'no_bar'],
  ['The price of Brent crude oil will reach or exceed $200 per barrel before December 31, 2026.', { comparator: '>=', value: 200, unit: 'USD per barrel' }],
  ['By December 31, 2027, at least 20% of global programmer jobs will have been replaced by AI.', { comparator: '>=', value: 20, unit: 'percent' }],
  ['Daatan will have a higher reported active user count than Kalshi in Israel by December 31, 2027.', 'no_bar'],
  ['Vladimir Putin will make fewer public appearances in the full calendar year 2026 compared to the full calendar year 2025.', 'no_bar'],
  ['Kalshi will become more popular than Polymarket by December 31, 2026.', 'no_bar'],
  ['President Trump will post more tweets on X (formerly Twitter) discussing domestic economic issues than the Iran war by December 31, 2026.', 'no_bar'],
  ['The S&P 500 index will experience a market crash of 20% or more from its peak by December 31, 2027.', { comparator: '>=', value: 20, unit: 'percent' }],
  ['Magnus Carlsen will no longer be the FIDE World No. 1 rated chess player by December 31, 2028.', 'no_bar'],
  ['Bitcoin will reach $100k by end of 2026', { comparator: '>=', value: 100_000, unit: 'USD' }],
]

describe('parseQuestionQuantity — prod golden fixture', () => {
  it.each(PROD)('%s', (question, expected) => {
    const parsed = parseQuestionQuantity(question)
    if (typeof expected === 'string') {
      expect(parsed).toEqual({ quantity: null, reason: expected })
    } else {
      expect(parsed).toEqual({ quantity: expected, reason: null })
    }
  })

  it('parses every prod question that states a numeric bar, and nothing else', () => {
    const parsed = PROD.filter(([q]) => parseQuestionQuantity(q).quantity !== null).length
    // 21 of 43. 16 state no numeric bar at all (comparatives, ranks, "return to
    // normal"); 6 state one the parser declines: a bar after a verb with no
    // comparator ("earn 30,000 shekels", "a rating of 2800", "a net worth of
    // $1 trillion"), "4 of the seven", two bars, and a bar with no unit.
    expect(parsed).toBe(PROD.filter(([, e]) => typeof e !== 'string').length)
  })
})

describe('parseQuestionQuantity — edge cases', () => {
  it.each<Case>([
    ['Will inflation stay at most 2.5% through 2027?', { comparator: '<=', value: 2.5, unit: 'percent' }],
    ['Gold will trade below $2,000 per ounce by June 2027.', { comparator: '<', value: 2000, unit: 'USD per ounce' }],
    ['The coalition will win between 55 and 60 seats.', { comparator: 'between', value: 55, value_hi: 60, unit: 'seats' }],
    ['The ceasefire will last between 3 and 6 months.', 'no_bar'],
    ['The 10-year yield will end the year between 4% and 5%.', { comparator: 'between', value: 4, value_hi: 5, unit: 'percent' }],
    ['Tesla market cap will top $2 trillion by 2027.', 'no_bar'],
    ['The ceasefire will hold for more than 6 months.', 'time_span'],
    ['Will it happen over 2027?', 'year_like'],
    ['Revenue will exceed $2bn in 2027.', { comparator: '>', value: 2, unit: 'billion USD' }],
    ['The company will sell at least 5 million cars in 2027.', { comparator: '>=', value: 5, unit: 'million cars' }],
    ['Brent crude will not exceed $100 per barrel in 2027.', 'negated'],
    ["Brent crude won't reach $100 per barrel in 2027.", 'negated'],
    ['Brent crude will fail to reach $100 per barrel in 2027.', 'negated'],
    ['Brent will never trade above $150 per barrel.', 'negated'],
    ['The party will no longer poll over 10% by June.', 'negated'],
  ])('%s', (question, expected) => {
    const parsed = parseQuestionQuantity(question)
    if (typeof expected === 'string') expect(parsed).toEqual({ quantity: null, reason: expected })
    else expect(parsed).toEqual({ quantity: expected, reason: null })
  })
})

describe('questionQuantityParam', () => {
  const q = 'Brent crude oil price will cross the $100 per barrel mark at least once by December 31, 2026.'
  it('is sent only for THRESHOLD questions', () => {
    expect(questionQuantityParam(q, ClaimArchetype.THRESHOLD)).toEqual({ comparator: '>=', value: 100, unit: 'USD per barrel' })
    expect(questionQuantityParam(q, ClaimArchetype.DIFFUSE)).toBeUndefined()
    expect(questionQuantityParam(q, null)).toBeUndefined()
  })
  it('is omitted, not null, when there is no bar', () => {
    expect(questionQuantityParam('Kalshi will become more popular than Polymarket by 2027.', ClaimArchetype.THRESHOLD)).toBeUndefined()
  })
})
