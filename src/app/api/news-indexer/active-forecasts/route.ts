import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-news-indexer-secret')
  if (!env.NEWS_INDEXER_SECRET || !secret || secret !== env.NEWS_INDEXER_SECRET) {
    return apiError('Unauthorized', 401)
  }

  const predictions = await prisma.prediction.findMany({
    // isPublic:false is also how a low-value/false-premise forecast gets moderated out of
    // the funnel (daatan#1603) — the public listing endpoint already excludes these by
    // default, but this feed queried on status alone, so a private forecast burned the same
    // matching+judging cost as a public one while being invisible to any review that only
    // browses the public listing.
    where: { status: 'ACTIVE', isPublic: true },
    select: {
      id: true,
      claimText: true,
      // The two inputs to retro's Gate-0 evidence window (news-indexer#394). news-indexer
      // applies its lower edge at match time so a 2021 article never reaches the judge;
      // Gate-0 keeps enforcing the full window at aggregation. Both must read the same
      // fields, or the two gates disagree about which rows are in-window.
      createdAt: true,
      claimArchetype: true,
      // claimText translations let news-indexer build a multilingual forecast
      // embedding, so articles in he/ar/ru match an English-authored claim.
      translations: {
        where: { fieldName: 'claimText' },
        select: { language: true, translatedText: true },
      },
    },
  })

  return NextResponse.json(
    predictions.map(p => ({
      id: p.id,
      question: p.claimText,
      createdAt: p.createdAt.toISOString(),
      claimArchetype: p.claimArchetype,
      translations: p.translations.map(t => ({ language: t.language, text: t.translatedText })),
    })),
  )
}
