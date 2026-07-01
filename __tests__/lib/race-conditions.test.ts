import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createCommitment } from '@/lib/services/commitment'

// Mock the dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    commitment: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn(), notifyServerError: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/services/ai-estimate', () => ({ triggerAiProbabilityEstimate: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('Race Conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('lockedAt race condition', () => {
    it('handles concurrent first commitments by updating lockedAt if count is 0', async () => {
      // Setup: Mock a prediction that is not locked
      const mockPrediction = {
        id: 'pred-1',
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        claimText: 'Test Prediction',
        authorId: 'author-1',
        lockedAt: null,
        options: [],
      }
      
      const mockUser = {
        id: 'user-1',
        rs: 100,
      }

      vi.mocked(prisma.prediction.findUnique).mockResolvedValue(mockPrediction as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null) // No existing commitment
      
      // Simulate no prior commitments (first commitment)
      vi.mocked(prisma.commitment.findMany).mockResolvedValue([])
      vi.mocked(prisma.commitment.create).mockResolvedValue({
        id: 'commit-1',
        user: { name: 'Test' },
        prediction: mockPrediction,
      } as any)

      // Act: Call createCommitment
      await createCommitment('user-1', 'pred-1', { confidence: 10 })

      // Verify: lockedAt update was called because count was 0
      expect(prisma.prediction.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'pred-1' },
        data: expect.objectContaining({
          lockedAt: expect.any(Date)
        })
      }))
    })
  })

  describe('Slug collision handling', () => {
    // Note: Slug collision is handled in the API route with a retry loop.
    // Here we can test the generateUniqueSlug utility which is part of the logic.
    it('generateUniqueSlug appends incrementing suffixes', async () => {
      const { generateUniqueSlug } = await import('@/lib/utils/slugify')
      
      const baseSlug = 'test-prediction'
      const existing = ['test-prediction', 'test-prediction-1', 'test-prediction-2']
      
      const unique = generateUniqueSlug(baseSlug, existing)
      expect(unique).toBe('test-prediction-3')
    })
  })
})
