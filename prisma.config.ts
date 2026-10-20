import { defineConfig } from 'prisma/config'

export default defineConfig({
  // Prisma 7 reads the seed command from here (package.json#prisma is ignored).
  // On demand only — no deploy runs it. See docs/SELF_HOSTING.md.
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
