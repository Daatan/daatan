import { prisma } from '@/lib/prisma'
import { BOT_REGISTRY } from '@/agents/bots'
import { createLogger } from '@/lib/logger'

const log = createLogger('bots-sync')

export async function syncBotsToDatabase() {
    log.info('Starting synchronization of bot configurations...')

    const activeUsernames = new Set<string>()

    for (const bot of BOT_REGISTRY) {
        const email = `${bot.username}@daatan.internal`
        activeUsernames.add(bot.username)

        const existingUser = await prisma.user.findUnique({ where: { username: bot.username } })

        if (existingUser) {
            // Update existing bot's config
            await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    name: bot.name,
                    // We don't overwrite CU available on sync so we don't reset their balance
                    botConfig: {
                        upsert: {
                            create: {
                                personaPrompt: bot.personaPrompt,
                                forecastPrompt: bot.forecastPrompt,
                                votePrompt: bot.votePrompt,
                                newsSources: bot.newsSources,
                                intervalMinutes: bot.intervalMinutes,
                                maxForecastsPerDay: bot.maxForecastsPerDay,
                                maxVotesPerDay: bot.maxVotesPerDay,
                                stakeMin: bot.stakeMin,
                                stakeMax: bot.stakeMax,
                                modelPreference: bot.modelPreference,
                                hotnessMinSources: bot.hotnessMinSources,
                                hotnessWindowHours: bot.hotnessWindowHours,
                                isActive: true,
                            },
                            update: {
                                personaPrompt: bot.personaPrompt,
                                forecastPrompt: bot.forecastPrompt,
                                votePrompt: bot.votePrompt,
                                newsSources: bot.newsSources,
                                intervalMinutes: bot.intervalMinutes,
                                maxForecastsPerDay: bot.maxForecastsPerDay,
                                maxVotesPerDay: bot.maxVotesPerDay,
                                stakeMin: bot.stakeMin,
                                stakeMax: bot.stakeMax,
                                modelPreference: bot.modelPreference,
                                hotnessMinSources: bot.hotnessMinSources,
                                hotnessWindowHours: bot.hotnessWindowHours,
                                isActive: true,
                            }
                        }
                    }
                }
            })
        } else {
            // Create new bot
            await prisma.user.create({
                data: {
                    email,
                    name: bot.name,
                    username: bot.username,
                    slug: bot.username,
                    isBot: true,
                    emailNotifications: false,
                    isPublic: true,
                    botConfig: {
                        create: {
                            personaPrompt: bot.personaPrompt,
                            forecastPrompt: bot.forecastPrompt,
                            votePrompt: bot.votePrompt,
                            newsSources: bot.newsSources,
                            intervalMinutes: bot.intervalMinutes,
                            maxForecastsPerDay: bot.maxForecastsPerDay,
                            maxVotesPerDay: bot.maxVotesPerDay,
                            stakeMin: bot.stakeMin,
                            stakeMax: bot.stakeMax,
                            modelPreference: bot.modelPreference,
                            hotnessMinSources: bot.hotnessMinSources,
                            hotnessWindowHours: bot.hotnessWindowHours,
                            isActive: true,
                        },
                    },
                },
            })
            log.info({ username: bot.username }, 'Created new bot user')
        }
    }

    // Find bots in the database that are NOT in the registry anymore and disable them
    const dbBots = await prisma.user.findMany({
        where: { isBot: true },
        select: { id: true, username: true }
    })

    let disabledCount = 0
    for (const dbBot of dbBots) {
        if (dbBot.username && !activeUsernames.has(dbBot.username)) {
            await prisma.botConfig.updateMany({
                where: { userId: dbBot.id },
                data: { isActive: false }
            })
            disabledCount++
        }
    }

    log.info({ activeBots: BOT_REGISTRY.length, disabledCount }, 'Bot synchronization complete')
}
