// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

/**
 * Crawlers matched by `htmlLimitedBots` get metadata in <head> instead of streamed into
 * <body>; Google ignored the body-placed canonicals (daatan#2055).
 */

const require = createRequire(import.meta.url)
const config = require(path.resolve(__dirname, '../..', 'next.config.js'))
const { shouldServeStreamingMetadata } = require('next/dist/server/lib/streaming-metadata')

const blocks = (ua: string) => !shouldServeStreamingMetadata(ua, config.htmlLimitedBots.source)

describe('next.config htmlLimitedBots', () => {
  it.each([
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    // Still covered by Next's default list, which the config extends rather than replaces.
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  ])('puts metadata in <head> for %s', (ua) => {
    expect(blocks(ua)).toBe(true)
  })

  it('keeps streaming metadata for a regular browser', () => {
    expect(blocks('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe(false)
  })
})
