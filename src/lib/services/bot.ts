import { prisma } from '@/lib/prisma'

const BOT_CONFIG_SELECT = {
  id: true,
  userId: true,
  personaPrompt: true,
  forecastPrompt: true,
  votePrompt: true,
  newsSources: true,
  intervalMinutes: true,
  maxForecastsPerDay: true,
  maxVotesPerDay: true,
  stakeMin: true,
  stakeMax: true,
  modelPreference: true,
  hotnessMinSources: true,
  hotnessWindowHours: true,
  activeHoursStart: true,
  activeHoursEnd: true,
  tagFilter: true,
  voteBias: true,
  canCreateForecasts: true,
  canVote: true,
  autoApprove: true,
  requireApprovalForForecasts: true,
  enableSentimentExtraction: true,
  enableRejectionTracking: true,
  showMetadataOnForecast: true,
  maxForecastsPerHour: true,
  isActive: true,
  lastRunAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, username: true, image: true } },
  runLogs: { orderBy: { runAt: 'desc' as const }, take: 1, select: { runAt: true, action: true, error: true } },
} as const

export async function listBots() {
  const bots = await prisma.botConfig.findMany({ select: BOT_CONFIG_SELECT, orderBy: { createdAt: 'asc' } })

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const botIds = bots.map(b => b.id)
  const todayCounts = await prisma.botRunLog.groupBy({
    by: ['botId', 'action'],
    where: {
      botId: { in: botIds },
      action: { in: ['CREATED_FORECAST', 'VOTED'] },
      isDryRun: false,
      runAt: { gte: startOfDay },
    },
    _count: { _all: true },
  })

  const countsByBot = new Map<string, { forecastsToday: number; votesToday: number }>()
  for (const row of todayCounts) {
    const entry = countsByBot.get(row.botId) ?? { forecastsToday: 0, votesToday: 0 }
    if (row.action === 'CREATED_FORECAST') entry.forecastsToday = row._count._all
    if (row.action === 'VOTED') entry.votesToday = row._count._all
    countsByBot.set(row.botId, entry)
  }

  return bots.map(bot => {
    const { forecastsToday, votesToday } = countsByBot.get(bot.id) ?? { forecastsToday: 0, votesToday: 0 }
    const nextRunAt = bot.lastRunAt
      ? new Date(bot.lastRunAt.getTime() + bot.intervalMinutes * 60 * 1000)
      : null

    return {
      id: bot.id,
      isActive: bot.isActive,
      intervalMinutes: bot.intervalMinutes,
      maxForecastsPerDay: bot.maxForecastsPerDay,
      maxVotesPerDay: bot.maxVotesPerDay,
      stakeMin: bot.stakeMin,
      stakeMax: bot.stakeMax,
      modelPreference: bot.modelPreference,
      hotnessMinSources: bot.hotnessMinSources,
      hotnessWindowHours: bot.hotnessWindowHours,
      personaPrompt: bot.personaPrompt,
      forecastPrompt: bot.forecastPrompt,
      votePrompt: bot.votePrompt,
      newsSources: bot.newsSources,
      activeHoursStart: bot.activeHoursStart,
      activeHoursEnd: bot.activeHoursEnd,
      tagFilter: bot.tagFilter,
      voteBias: bot.voteBias,
      canCreateForecasts: bot.canCreateForecasts,
      canVote: bot.canVote,
      autoApprove: bot.autoApprove,
      requireApprovalForForecasts: bot.requireApprovalForForecasts,
      enableSentimentExtraction: bot.enableSentimentExtraction,
      enableRejectionTracking: bot.enableRejectionTracking,
      showMetadataOnForecast: bot.showMetadataOnForecast,
      maxForecastsPerHour: bot.maxForecastsPerHour,
      lastRunAt: bot.lastRunAt,
      nextRunAt,
      forecastsToday,
      votesToday,
      lastLog: bot.runLogs[0] || null,
      user: bot.user,
    }
  })
}

export async function getBotById(id: string) {
  return prisma.botConfig.findUnique({ where: { id } })
}

export async function getBotConfigByUserId(userId: string) {
  return prisma.botConfig.findUnique({ where: { userId } })
}

export async function getBotCount() {
  return prisma.botConfig.count()
}

export async function findBotUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } })
}

export interface CreateBotData {
  name: string
  username: string
  personaPrompt: string
  forecastPrompt: string
  votePrompt: string
  newsSources: string[]
  intervalMinutes: number
  maxForecastsPerDay: number
  maxVotesPerDay: number
  stakeMin: number
  stakeMax: number
  modelPreference: string
  hotnessMinSources: number
  hotnessWindowHours: number
  activeHoursStart: number | null
  activeHoursEnd: number | null
  tagFilter: string[]
  voteBias: number
  canCreateForecasts: boolean
  canVote: boolean
  requireApprovalForForecasts: boolean
  enableSentimentExtraction: boolean
  enableRejectionTracking: boolean
  showMetadataOnForecast: boolean
  maxForecastsPerHour: number
}

export async function createBotInDb(data: CreateBotData) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `${data.username}@daatan.internal`,
        name: data.name,
        username: data.username,
        slug: data.username,
        isBot: true,
        emailNotifications: false,
        isPublic: true,
      },
    })

    return tx.botConfig.create({
      data: {
        userId: user.id,
        personaPrompt: data.personaPrompt,
        forecastPrompt: data.forecastPrompt,
        votePrompt: data.votePrompt,
        newsSources: data.newsSources,
        intervalMinutes: data.intervalMinutes,
        maxForecastsPerDay: data.maxForecastsPerDay,
        maxVotesPerDay: data.maxVotesPerDay,
        stakeMin: data.stakeMin,
        stakeMax: data.stakeMax,
        modelPreference: data.modelPreference,
        hotnessMinSources: data.hotnessMinSources,
        hotnessWindowHours: data.hotnessWindowHours,
        activeHoursStart: data.activeHoursStart,
        activeHoursEnd: data.activeHoursEnd,
        tagFilter: data.tagFilter,
        voteBias: data.voteBias,
        canCreateForecasts: data.canCreateForecasts,
        canVote: data.canVote,
        requireApprovalForForecasts: data.requireApprovalForForecasts,
        enableSentimentExtraction: data.enableSentimentExtraction,
        enableRejectionTracking: data.enableRejectionTracking,
        showMetadataOnForecast: data.showMetadataOnForecast,
        maxForecastsPerHour: data.maxForecastsPerHour,
      },
      include: { user: true },
    })
  })
}

export interface UpdateBotData {
  personaPrompt?: string
  forecastPrompt?: string
  votePrompt?: string
  newsSources?: string[]
  intervalMinutes?: number
  maxForecastsPerDay?: number
  maxVotesPerDay?: number
  stakeMin?: number
  stakeMax?: number
  modelPreference?: string
  hotnessMinSources?: number
  hotnessWindowHours?: number
  isActive?: boolean
  activeHoursStart?: number | null
  activeHoursEnd?: number | null
  tagFilter?: string[]
  voteBias?: number
  canCreateForecasts?: boolean
  canVote?: boolean
  requireApprovalForForecasts?: boolean
  enableSentimentExtraction?: boolean
  enableRejectionTracking?: boolean
  showMetadataOnForecast?: boolean
  maxForecastsPerHour?: number
}

export async function updateBot(id: string, data: UpdateBotData) {
  return prisma.botConfig.update({
    where: { id },
    data,
    include: { user: { select: { id: true, name: true, username: true } } },
  })
}

export async function disableBot(id: string) {
  return prisma.botConfig.update({
    where: { id },
    data: { isActive: false },
  })
}

export async function listBotLogs(botId: string, page: number, limit: number) {
  const [logs, total] = await Promise.all([
    prisma.botRunLog.findMany({
      where: { botId },
      orderBy: { runAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.botRunLog.count({ where: { botId } }),
  ])

  return { logs, total }
}
