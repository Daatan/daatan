// On-demand bootstrap — never part of a deploy. Promotes the configured admin
// emails to ADMIN (see seed-admins.ts); with SEED_DEMO_DATA=1 it also adds
// sample forecasts, the bot registry and notifications for a local dev DB.
// Run: `npx prisma db seed` (see docs/SELF_HOSTING.md).
import crypto from 'crypto'
import { createSeedPrismaClient } from './seed-client'
import { resolveAdminTargets, seedAdmins } from './seed-admins'

const prisma = createSeedPrismaClient()

async function main() {
  console.log('Seeding admins...')
  await seedAdmins(prisma, resolveAdminTargets({
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    DAATAN_EDITION: process.env.DAATAN_EDITION,
  }))

  const privileged = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'APPROVER', 'RESOLVER'] } },
    select: { id: true, email: true, role: true },
  })
  console.log(`Privileged users on this database: ${JSON.stringify(privileged)}`)

  if (process.env.SEED_DEMO_DATA !== '1') return

  await seedDemoPredictions()
  await seedBots()
  await seedNotifications()
}

async function seedDemoPredictions() {
  console.log('Seeding predictions...')
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })

  if (admin) {
    const predictions = [
      {
        claimText: "Bitcoin will reach $100k by end of 2026",
        slug: "btc-100k-2026",
        detailsText: "Prediction based on current market trends and halving cycles.",
        outcomeType: 'BINARY',
        resolveByDatetime: new Date("2026-12-31T23:59:59Z"),
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        claimText: "SpaceX Starship successfully orbits Earth in next launch",
        slug: "spacex-starship-orbit-next",
        detailsText: "Success defined as completing at least one full orbit and splashing down.",
        outcomeType: 'BINARY',
        resolveByDatetime: new Date("2026-06-30T12:00:00Z"),
        status: 'ACTIVE',
        publishedAt: new Date(),
      },
      {
        claimText: "GPT-5 released before Q3 2026",
        slug: "gpt-5-release-q3-2026",
        outcomeType: 'BINARY',
        resolveByDatetime: new Date("2026-09-30T23:59:59Z"),
        status: 'DRAFT',
        publishedAt: null,
      }
    ]

    for (const p of predictions) {
      await prisma.prediction.upsert({
        where: { slug: p.slug },
        update: {},
        create: {
          ...p,
          outcomeType: p.outcomeType as any,
          status: p.status as any,
          authorId: admin.id,
          shareToken: crypto.randomBytes(8).toString('hex'),
        }
      })
      console.log(`Upserted prediction: ${p.slug}`)
    }
  }
}

async function seedBots() {
  // Leverage the central code-based bot registry to seed the database
  const { syncBotsToDatabase } = await import('../src/lib/bots/sync')
  await syncBotsToDatabase()
}

async function seedNotifications() {
  console.log('Seeding notifications...')

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  const bot = await prisma.user.findFirst({ where: { isBot: true } })
  const prediction = await prisma.prediction.findFirst()

  if (!admin) {
    console.log('No admin found, skipping notifications.')
    return
  }

  // Skip if admin already has notifications (idempotent — don't reset read state on re-deploy)
  const existingCount = await prisma.notification.count({ where: { userId: admin.id } })
  if (existingCount > 0) {
    console.log(`Skipping notifications seed — admin already has ${existingCount} notifications.`)
    return
  }

  const notifications = [
    {
      userId: admin.id,
      type: 'SYSTEM',
      title: 'Welcome to DAATAN!',
      message: 'Your account has been successfully created. Start by making your first forecast.',
      read: false,
    },
  ]

  if (bot && prediction) {
    notifications.push(
      {
        userId: admin.id,
        type: 'NEW_COMMITMENT',
        title: 'New commitment on your forecast',
        message: `${bot.name} has committed to your forecast.`,
        read: false,
      } as any,
      {
        userId: admin.id,
        type: 'COMMENT_ON_FORECAST',
        title: 'New comment on your forecast',
        message: `${bot.name} commented: "I think the historical data supports this."`,
        read: false,
      } as any,
      {
        userId: admin.id,
        type: 'MENTION',
        title: 'You were mentioned',
        message: `${bot.name} mentioned you in a comment.`,
        read: false,
      } as any,
      {
        userId: admin.id,
        type: 'COMMITMENT_RESOLVED',
        title: 'Forecast resolved',
        message: 'A forecast you committed to has been resolved as correct!',
        read: true,
      } as any
    )

    // add links and refs
    for (let i = 1; i < notifications.length; i++) {
      (notifications[i] as any).predictionId = prediction.id;
      (notifications[i] as any).actorId = bot.id;
      if (notifications[i].type === 'COMMENT_ON_FORECAST' || notifications[i].type === 'MENTION') {
        (notifications[i] as any).link = `/forecasts/${prediction.id}#comments`;
      } else {
        (notifications[i] as any).link = `/forecasts/${prediction.id}`;
      }
    }
  }

  for (const n of notifications) {
    await prisma.notification.create({
      data: n as any
    })
  }
  console.log(`Created ${notifications.length} notifications for admin`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
