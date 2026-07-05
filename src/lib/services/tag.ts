import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/utils/slugify'

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
  const slug = slugify(name)

  const existing = await prisma.tag.findUnique({ where: { slug } })
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
