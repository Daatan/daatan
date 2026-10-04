import { prisma } from '@/lib/prisma'
import { tagSlug } from '@/lib/utils/tag-slug'
import { normalizeForecastTags } from '@/lib/forecast-tags'

export const listTags = async () => {
  const tags = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { predictions: true } },
    },
    orderBy: [
      { predictions: { _count: 'desc' } },
      { name: 'asc' },
    ],
  })
  return tags.map(tag => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    count: tag._count.predictions,
  }))
}

export const getTagBySlug = async (slug: string) => {
  const tag = await prisma.tag.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, _count: { select: { predictions: true } } },
  })
  if (!tag) return null
  return { id: tag.id, name: tag.name, slug: tag.slug, count: tag._count.predictions }
}

/** Count of a tag's predictions currently visible on the tag page (public + active). */
export const getVisibleTagPredictionCount = async (tagId: string) => {
  return prisma.prediction.count({
    where: { status: 'ACTIVE', isPublic: true, tags: { some: { id: tagId } } },
  })
}

export const createTag = async (name: string) => {
  const slug = tagSlug(name)

  const existing = await prisma.tag.findFirst({ where: { OR: [{ slug }, { name: name.trim() }] } })
  if (existing) {
    return { ok: false as const, error: 'Tag with this name already exists', status: 409 }
  }

  const tag = await prisma.tag.create({ data: { name: name.trim(), slug } })
  return {
    ok: true as const,
    data: { id: tag.id, name: tag.name, slug: tag.slug },
    status: 201,
  }
}

/**
 * `connectOrCreate` entries for a forecast's tags. A tag that already exists is matched
 * by name first and keeps its stored slug: name is unique too, so a row whose slug was
 * computed differently (before tagSlug, daatan#1794) would otherwise fail the create.
 */
export const tagConnectOrCreate = async (rawTags: readonly unknown[] | null | undefined) => {
  const names = normalizeForecastTags(rawTags)
  if (names.length === 0) return []
  const existing = await prisma.tag.findMany({
    where: { name: { in: names } },
    select: { name: true, slug: true },
  })
  const slugByName = new Map(existing.map(t => [t.name, t.slug]))
  return names.map(name => {
    const slug = slugByName.get(name) ?? tagSlug(name)
    return { where: { slug }, create: { name, slug } }
  })
}
