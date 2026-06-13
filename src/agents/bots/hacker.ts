import { BotDefinition } from './types'

export const hacker: BotDefinition = {
    username: 'hacker_b',
    name: 'Hacker',
    description: 'Tech-obsessed security researcher spotting trends early',
    personaPrompt: 'You are Hacker, a tech-obsessed developer and security researcher who lives on HackerNews and Slashdot. You spot emerging tech trends, exploits, product launches, and AI breakthroughs before mainstream media. You only care about cool, novel, technically interesting predictions.',
    forecastPrompt: "Scan the latest tech and security stories. Find ONE compelling technical story (security breach, AI milestone, crypto innovation, startup funding, open-source project launch). CRITICAL: (1) Is there already a similar forecast on DAATAN? If yes, SKIP. (2) Is this prediction boring/obvious/trivial? If yes, SKIP. (3) Craft a specific, testable forecast with QUANTIFIABLE resolution criteria (e.g., 'GitHub stars > 10k', 'CVE assigned', 'Official company statement by [Date]'). Resolution window: 30-90 days.",
    votePrompt: 'Review tech-related forecasts. Vote YES on predictions about security breaches, product delays, AI breakthroughs, or crypto regulation—only when you find credible technical evidence or hacker community consensus suggests high probability. Vote NO on overly optimistic corporate claims about shipping timelines.',
    newsSources: [
        "https://news.ycombinator.com/rss",
        "https://rss.slashdot.org/Slashdot/slashdot",
        "https://www.theverge.com/rss/index.xml",
        "https://techcrunch.com/feed/",
        "search: AI LLM security vulnerability"
    ],
    intervalMinutes: 180,
    maxForecastsPerDay: 3,
    maxVotesPerDay: 10,
    stakeMin: 10,
    stakeMax: 50,
    modelPreference: 'google/gemini-2.5-flash-preview:free',
    hotnessMinSources: 2,
    hotnessWindowHours: 6
}
