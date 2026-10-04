import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { tagConnectOrCreate } from '../tag'

// daatan#1794: unit tests mock Prisma, so the connectOrCreate-by-slug write never ran
// against a real database — and every non-Latin tag slugified to '' and landed on the
// same row. These go through the real unique constraints.
async function createForecastWithTags(authorId: string, tags: string[], n: number) {
  return prisma.prediction.create({
    data: {
      claimText: `Tag test ${n}`,
      authorId,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `tag-test-${n}-${Date.now()}`,
      tags: { connectOrCreate: await tagConnectOrCreate(tags) },
    },
    select: { tags: { select: { name: true, slug: true } } },
  })
}

describe('tagConnectOrCreate (integration)', () => {
  it('keeps different non-Latin tags apart across forecasts', async () => {
    const user = await prisma.user.create({ data: { email: 'tags@example.com', name: 'Tags' } })

    const a = await createForecastWithTags(user.id, ['Россия'], 1)
    const b = await createForecastWithTags(user.id, ['בחירות'], 2)
    const c = await createForecastWithTags(user.id, ['בחירות', 'כלכלה', 'AI'], 3)

    expect(a.tags).toEqual([{ name: 'Россия', slug: 'rossiya' }])
    expect(b.tags.map(t => t.name)).toEqual(['בחירות'])
    expect(c.tags.map(t => t.name).sort()).toEqual(['AI', 'בחירות', 'כלכלה'].sort())
    expect(await prisma.tag.count()).toBe(4)
  })

  it('reuses an existing tag by name even when its stored slug predates tagSlug', async () => {
    const user = await prisma.user.create({ data: { email: 'legacy@example.com', name: 'Legacy' } })
    await prisma.tag.create({ data: { name: 'Россия', slug: 'legacy-slug' } })

    const f = await createForecastWithTags(user.id, ['Россия'], 4)

    expect(f.tags).toEqual([{ name: 'Россия', slug: 'legacy-slug' }])
    expect(await prisma.tag.count()).toBe(1)
  })
})
