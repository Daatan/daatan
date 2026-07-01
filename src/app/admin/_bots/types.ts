export interface RssItem {
  title: string
  url: string
  source: string
  publishedAt: string
}

export interface HotTopic {
  title: string
  items: RssItem[]
  sourceCount: number
}

export interface BotRunSummary {
  botId: string
  botName: string
  forecastsCreated: number
  votes: number
  skipped: number
  errors: number
  dryRun: boolean
  hotTopics?: HotTopic[]
  fetchedCount?: number
  sampleItems?: string[]
}

export interface BotLog {
  id: string
  runAt: string
  action: string
  triggerNews: { title?: string; urls?: string[] } | null
  generatedText: string | null
  forecastId: string | null
  isDryRun: boolean
  error: string | null
}

export interface Bot {
  id: string
  isActive: boolean
  intervalMinutes: number
  maxForecastsPerDay: number
  maxVotesPerDay: number
  stakeMin: number
  stakeMax: number
  modelPreference: string
  hotnessMinSources: number
  hotnessWindowHours: number
  personaPrompt: string
  forecastPrompt: string
  votePrompt: string
  newsSources: string[]
  activeHoursStart: number | null
  activeHoursEnd: number | null
  tagFilter: string[]
  voteBias: number
  canCreateForecasts: boolean
  canVote: boolean
  autoApprove: boolean
  requireApprovalForForecasts: boolean
  enableSentimentExtraction: boolean
  enableRejectionTracking: boolean
  showMetadataOnForecast: boolean
  maxForecastsPerHour: number
  lastRunAt: string | null
  nextRunAt: string | null
  forecastsToday: number
  votesToday: number
  lastLog: { runAt: string; action: string; error: string | null } | null
  user: { id: string; name: string | null; username: string | null }
}
