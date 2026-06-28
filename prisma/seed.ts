import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function main() {
  // ADMIN_EMAIL (comma/space separated) seeds the first admin(s) on a self-host
  // without editing code. Falls back to the SaaS owners when unset, so existing
  // dev/staging/prod seeding is unchanged.
  const adminEmails = process.env.ADMIN_EMAIL
    ? process.env.ADMIN_EMAIL.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)
    : ['komapc@gmail.com', 'andrey1bar@gmail.com']

  console.log('Start seeding admins...')

  for (const email of adminEmails) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      console.log(`Found user ${email} (id=${existing.id}, current role=${existing.role})`)
    } else {
      console.log(`User ${email} not found — will create`)
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN' },
      create: {
        email,
        name: email.split('@')[0], // Replaced on first Google login
        role: 'ADMIN',
        username: email.split('@')[0], // Fallback username
      },
    })
    console.log(`✅ User ${user.email} → role=${user.role} (id=${user.id}, name=${user.name})`)
  }

  // Also promote known user IDs that may have been created via OAuth
  // with a different email mapping (duplicate account edge case)
  const adminUserIds = [
    'cml6p9bqz0000jnyvw6tx5uzq', // Mark Janwuf (prod)
    'cml7r4krc0000fjmqkxz3rrwg', // Marik marik (prod)
  ]

  for (const id of adminUserIds) {
    try {
      const user = await prisma.user.update({
        where: { id },
        data: { role: 'ADMIN' },
      })
      console.log(`✅ User by ID ${id} → role=ADMIN (name=${user.name})`)
    } catch {
      // User ID doesn't exist on this environment (e.g., staging) — skip
    }
  }

  // Verify: list all ADMIN/APPROVER users
  const privileged = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'APPROVER', 'RESOLVER'] } },
    select: { id: true, email: true, name: true, role: true },
  })
  console.log(`Privileged users on this environment: ${JSON.stringify(privileged)}`)

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
  .then(() => seedBots())
  .then(() => seedNotifications())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
