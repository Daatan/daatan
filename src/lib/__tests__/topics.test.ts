import { describe, it, expect } from 'vitest'
import { STANDARD_TAGS } from '@/lib/constants'
import { orderTopics, standardTopic, TOPIC_SLUGS } from '../topics'

describe('standardTopic', () => {
  it('recognises any spelling of a standard topic', () => {
    expect(standardTopic('politics')).toBe('Politics')
    expect(standardTopic('US POLITICS')).toBe('US Politics')
  })

  it('returns null for other tags', () => {
    expect(standardTopic('Israel')).toBeNull()
  })

  it('has one slug per standard topic', () => {
    expect(new Set(TOPIC_SLUGS).size).toBe(STANDARD_TAGS.length)
  })
})

describe('orderTopics', () => {
  it('puts selected topics first in pick order, then the rest by open forecasts', () => {
    const order = orderTopics(['Economy', 'AI'], { politics: 9, economy: 1, sports: 4, ai: 0 })
    expect(order).toEqual(['Economy', 'AI', 'Politics', 'Sports'])
  })

  it('hides topics with no open forecasts unless selected', () => {
    expect(orderTopics([], { politics: 2 })).toEqual(['Politics'])
  })

  it('breaks ties by the standard order', () => {
    expect(orderTopics([], { economy: 3, politics: 3 })).toEqual(['Politics', 'Economy'])
  })

  it('shows every topic in the standard order when counts are unavailable', () => {
    expect(orderTopics([], {})).toEqual(STANDARD_TAGS)
  })

  it('drops a selected value that is not a standard topic', () => {
    expect(orderTopics(['Nope'], { ai: 1 })).toEqual(['AI'])
  })
})
