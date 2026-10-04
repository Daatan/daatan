import { describe, it, expect } from 'vitest'
import { createPredictionSchema, updatePredictionSchema } from '@/lib/validations/prediction'

describe('Tags Validation', () => {
  const basePrediction = {
    claimText: 'Test prediction claim',
    resolveByDatetime: '2026-12-31T23:59:59Z',
    outcomeType: 'BINARY' as const,
    resolutionRules: 'Resolves YES if the event occurs as described.',
  }

  describe('createPredictionSchema', () => {
    it('accepts valid tags array (1-5 tags)', () => {
      const validData = {
        ...basePrediction,
        tags: ['AI', 'Technology'],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts single tag', () => {
      const validData = {
        ...basePrediction,
        tags: ['AI'],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts maximum 5 tags', () => {
      const validData = {
        ...basePrediction,
        tags: ['AI', 'Technology', 'Politics', 'Economy', 'Science'],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    // #1787: an over-long list is capped, not rejected — rejecting blocked publish.
    it('keeps the first 5 when given more than 5 tags', () => {
      const data = {
        ...basePrediction,
        tags: ['AI', 'Technology', 'Politics', 'Economy', 'Science', 'Crypto'],
      }

      const result = createPredictionSchema.safeParse(data)
      expect(result.success).toBe(true)
      expect(result.data?.tags).toEqual(['AI', 'Technology', 'Politics', 'Economy', 'Science'])
    })

    it('accepts empty tags array', () => {
      const validData = {
        ...basePrediction,
        tags: [],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts prediction without tags (optional field)', () => {
      const validData = {
        ...basePrediction,
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('drops empty tags', () => {
      const result = createPredictionSchema.safeParse({ ...basePrediction, tags: ['AI', ''] })
      expect(result.success).toBe(true)
      expect(result.data?.tags).toEqual(['AI'])
    })

    it('drops tags with names exceeding 50 characters', () => {
      const result = createPredictionSchema.safeParse({ ...basePrediction, tags: ['a'.repeat(51), 'AI'] })
      expect(result.success).toBe(true)
      expect(result.data?.tags).toEqual(['AI'])
    })

    it('accepts tags with exactly 50 characters', () => {
      const validData = {
        ...basePrediction,
        tags: ['a'.repeat(50)],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts tags with special characters and spaces', () => {
      const validData = {
        ...basePrediction,
        tags: ['US Politics', 'AI/ML', 'Climate Change'],
      }

      const result = createPredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })
  })

  describe('updatePredictionSchema', () => {
    it('accepts valid tags array for update', () => {
      const validData = {
        tags: ['AI', 'Technology'],
      }

      const result = updatePredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts single tag for update', () => {
      const validData = {
        tags: ['AI'],
      }

      const result = updatePredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts maximum 5 tags for update', () => {
      const validData = {
        tags: ['AI', 'Technology', 'Politics', 'Economy', 'Science'],
      }

      const result = updatePredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('keeps the first 5 when given more than 5 tags for update', () => {
      const result = updatePredictionSchema.safeParse({
        tags: ['AI', 'Technology', 'Politics', 'Economy', 'Science', 'Crypto'],
      })
      expect(result.success).toBe(true)
      expect(result.data?.tags).toHaveLength(5)
    })

    it('accepts empty tags array for update', () => {
      const validData = {
        tags: [],
      }

      const result = updatePredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('accepts update without tags field', () => {
      const validData = {
        claimText: 'Updated claim',
      }

      const result = updatePredictionSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('drops empty tags for update', () => {
      const result = updatePredictionSchema.safeParse({ tags: ['AI', ''] })
      expect(result.success).toBe(true)
      expect(result.data?.tags).toEqual(['AI'])
    })

    it('drops tags with names exceeding 50 characters for update', () => {
      const result = updatePredictionSchema.safeParse({ tags: ['a'.repeat(51)] })
      expect(result.success).toBe(true)
      expect(result.data?.tags).toEqual([])
    })
  })

  describe('Type inference', () => {
    it('infers correct type for create schema', () => {
      const validData = {
        ...basePrediction,
        tags: ['AI', 'Technology'],
      }

      const result = createPredictionSchema.safeParse(validData)
      if (result.success) {
        // Type checking: these should all be valid
        expect(result.data.tags).toBeDefined()
        expect(Array.isArray(result.data.tags)).toBe(true)
        expect(result.data.tags?.[0]).toBe('AI')
      }
    })

    it('infers correct type for update schema', () => {
      const validData = {
        tags: ['AI'],
      }

      const result = updatePredictionSchema.safeParse(validData)
      if (result.success) {
        expect(result.data.tags).toBeDefined()
        expect(result.data.tags?.[0]).toBe('AI')
      }
    })
  })
})
