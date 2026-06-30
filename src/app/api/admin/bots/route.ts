import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { z } from 'zod'
import { createBotLLMService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { botConfigGenerationSchema } from '@/lib/llm/schemas'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { listBots, getBotCount, findBotUserByUsername, createBotInDb } from '@/lib/services/bot'

const log = createLogger('admin-bots')

export const dynamic = 'force-dynamic'

const DEFAULT_PERSONA = 'You are a curious analyst who follows world news and enjoys making predictions about future events.'
const DEFAULT_FORECAST_PROMPT = 'Based on the news topic provided, create a specific and verifiable forecast. Be realistic about timeframes.'
const DEFAULT_VOTE_PROMPT = 'Based on your interests and the available forecasts, decide whether to commit to each one.'

const createBotSchema = z
  .object({
    name: z.string().min(2).max(50),
    personaPrompt: z.string().min(10).default(DEFAULT_PERSONA),
    forecastPrompt: z.string().min(10).default(DEFAULT_FORECAST_PROMPT),
    votePrompt: z.string().min(10).default(DEFAULT_VOTE_PROMPT),
    newsSources: z.array(z.string()).default([]),
    intervalMinutes: z.number().int().min(5).max(10080).default(360),
    maxForecastsPerDay: z.number().int().min(0).max(20).default(3),
    maxVotesPerDay: z.number().int().min(0).max(50).default(10),
    stakeMin: z.number().int().min(1).default(10),
    stakeMax: z.number().int().min(1).default(100),
    modelPreference: z.string().default('google/gemini-2.5-flash-preview:free'),
    hotnessMinSources: z.number().int().min(1).default(2),
    hotnessWindowHours: z.number().int().min(1).default(6),
    activeHoursStart: z.number().int().min(0).max(23).nullable().default(null),
    activeHoursEnd: z.number().int().min(0).max(23).nullable().default(null),
    tagFilter: z.array(z.string().min(1)).default([]),
    voteBias: z.number().int().min(0).max(100).default(50),
    cuRefillAt: z.number().int().min(0).default(0),
    cuRefillAmount: z.number().int().min(1).default(50),
    canCreateForecasts: z.boolean().default(true),
    canVote: z.boolean().default(true),
    requireApprovalForForecasts: z.boolean().default(false),
    enableSentimentExtraction: z.boolean().default(false),
    enableRejectionTracking: z.boolean().default(false),
    showMetadataOnForecast: z.boolean().default(false),
    maxForecastsPerHour: z.number().int().min(0).default(0),
  })
  .refine((d) => (d.activeHoursStart == null) === (d.activeHoursEnd == null), {
    message: 'activeHoursStart and activeHoursEnd must both be set or both be null',
    path: ['activeHoursStart'],
  })

// GET /api/admin/bots — list all bots
export const GET = withAuth(
  async () => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    try {
      const bots = await listBots()
      return NextResponse.json({ bots })
    } catch (err) {
      return handleRouteError(err, 'Failed to list bots')
    }
  },
  { roles: ['ADMIN'] },
)

// POST /api/admin/bots — create a new bot
export const POST = withAuth(
  async (request: NextRequest) => {
    const blocked = blockedOnSelfHost()
    if (blocked) return blocked
    try {
      const body = await request.json()
      const data = createBotSchema.parse(body)

      const botCount = await getBotCount()
      if (botCount >= env.MAX_BOTS) {
        return NextResponse.json({
          error: `Bot limit reached (${env.MAX_BOTS}). Delete existing bots to create new ones.`
        }, { status: 400 })
      }

      if (data.stakeMin > data.stakeMax) {
        return NextResponse.json({ error: 'stakeMin must be ≤ stakeMax' }, { status: 400 })
      }

      const username = `${data.name.toLowerCase().replace(/\s+/g, '_')}_b`

      const existing = await findBotUserByUsername(username)
      if (existing) {
        return NextResponse.json({ error: `Username ${username} is already taken` }, { status: 400 })
      }

      if (data.personaPrompt === DEFAULT_PERSONA) {
        try {
          const llm = createBotLLMService(data.modelPreference)
          const template = await getPromptTemplate('bot-config-generation')
          const prompt = fillPrompt(template, { name: data.name })

          const generatedSchema = z.object({
            personaPrompt: z.string().min(10),
            forecastPrompt: z.string().min(10),
            votePrompt: z.string().min(10),
            newsSources: z.array(z.string()).default([]),
          })

          const response = await llm.generateContent({ prompt, temperature: 0.7, schema: botConfigGenerationSchema })
          const parsed = generatedSchema.safeParse(JSON.parse(response.text))
          if (parsed.success) {
            data.personaPrompt = parsed.data.personaPrompt
            data.forecastPrompt = parsed.data.forecastPrompt
            data.votePrompt = parsed.data.votePrompt
            data.newsSources = parsed.data.newsSources
          } else {
            log.warn({ issues: parsed.error.issues }, 'LLM-generated bot config failed validation, using defaults')
          }
        } catch (llmErr) {
          log.error({ err: llmErr }, 'Failed to generate dynamic bot prompts, using defaults')
        }
      }

      const result = await createBotInDb({ ...data, username })

      return NextResponse.json({ bot: result }, { status: 201 })
    } catch (err) {
      return handleRouteError(err, 'Failed to create bot')
    }
  },
  { roles: ['ADMIN'] },
)
