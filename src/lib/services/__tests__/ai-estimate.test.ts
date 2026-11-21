import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { commitment: { update: vi.fn() } } }))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/llm/stageModels', () => ({ forStage: () => ({}) }))

import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'
import { triggerAiProbabilityEstimate } from '../ai-estimate'

describe('triggerAiProbabilityEstimate', () => {
  it("tags the claim-only guess so nothing labelled Oracul grades against it (daatan#2271)", async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: '35' } as never)

    await triggerAiProbabilityEstimate('c-1', 'A claim')

    expect(prisma.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { aiProbabilityAtCommit: 0.35, aiSourceAtCommit: 'claim_llm' },
    })
  })
})
