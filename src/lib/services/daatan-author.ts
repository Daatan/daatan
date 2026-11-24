import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { createNotification } from '@/lib/services/notification'
import { DAATAN_USERNAME } from '@/lib/daatan-account'
import { getAppUrl } from '@/lib/branding'

const log = createLogger('daatan-author')
const DAATAN_EMAIL = `${DAATAN_USERNAME}_system@daatan.internal`

/**
 * The public author of a forecast an admin publishes as Daatan (#2301). Mirrors
 * `getOrCreateOracle2SystemUser`: a plain `User` with `isBot: true` (so it is not counted as a
 * forecaster) and NO `BotConfig` (so the bot runner never picks it up). It never commits a
 * probability, so it never scores. The admin who actually created the forecast is recorded
 * in `PredictionCreator`, which only admin reads select.
 */
export async function getOrCreateDaatanUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: DAATAN_EMAIL }, select: { id: true } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      email: DAATAN_EMAIL,
      name: 'Daatan',
      username: DAATAN_USERNAME,
      slug: DAATAN_USERNAME,
      // Absolute, like the Google avatars every reader expects (profile OG image, JSON-LD).
      image: `${getAppUrl()}/logo-icon-192.png`,
      isBot: true,
      emailNotifications: false,
      isPublic: true,
    },
    select: { id: true },
  })
}

/** The admin who created a forecast published as Daatan, or null for any other forecast. */
export async function getRealCreatorId(predictionId: string): Promise<string | null> {
  const row = await prisma.predictionCreator.findUnique({ where: { predictionId }, select: { userId: true } })
  return row?.userId ?? null
}

/** Who created a forecast published as Daatan, for the admin-only line on its page. */
export async function getRealCreator(predictionId: string) {
  const row = await prisma.predictionCreator.findUnique({
    where: { predictionId },
    select: { user: { select: { id: true, name: true, username: true } } },
  })
  return row?.user ?? null
}

/**
 * A notification meant for a forecast's author (a new commitment, a comment). On a forecast
 * published as Daatan it goes to the admin who created it, a person, not the system account.
 * Fire-and-forget, like the `createNotification` calls it replaces.
 */
export function notifyForecastOwner(
  prediction: { id: string; authorId: string },
  input: Omit<Parameters<typeof createNotification>[0], 'userId'>,
): void {
  getRealCreatorId(prediction.id)
    .then((creatorId) => createNotification({ ...input, userId: creatorId ?? prediction.authorId }))
    .catch((err) => log.error({ err, predictionId: prediction.id }, 'Forecast owner notification failed'))
}
