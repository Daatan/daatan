import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pushSubscription: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

const { sendNotification, setVapidDetails, errorLog, debugLog, mockIsSelfHosted } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  errorLog: vi.fn(),
  debugLog: vi.fn(),
  mockIsSelfHosted: vi.fn().mockReturnValue(false),
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails,
    sendNotification,
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: debugLog, info: vi.fn(), warn: vi.fn(), error: errorLog }),
}))

vi.mock('@/lib/edition', () => ({ isSelfHosted: mockIsSelfHosted }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://forecasts.example.com' }))

import { prisma } from '@/lib/prisma'
import { dispatchBrowserPush } from '@/lib/services/push'

const findMany = vi.mocked(prisma.pushSubscription.findMany)
const updateMany = vi.mocked(prisma.pushSubscription.updateMany)
const deleteMany = vi.mocked(prisma.pushSubscription.deleteMany)

const SUB = {
  id: 'sub-1',
  userId: 'user-1',
  endpoint: 'https://push.example.com/1',
  p256dh: 'p256dh',
  auth: 'auth',
  userAgent: null,
  createdAt: new Date('2026-01-01'),
  lastUsedAt: null,
}

class WebPushError extends Error {
  statusCode: number
  constructor(statusCode: number) {
    super(`push failed with ${statusCode}`)
    this.statusCode = statusCode
  }
}

describe('dispatchBrowserPush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSelfHosted.mockReturnValue(false)
    process.env.VAPID_PRIVATE_KEY = 'test-private-key'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key'
    findMany.mockResolvedValue([SUB])
  })

  it('uses the Daatan literal VAPID contact on the SaaS edition', async () => {
    await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:push@daatan.com', 'test-public-key', 'test-private-key')
  })

  it('derives the VAPID contact from getAppUrl() on self-host', async () => {
    mockIsSelfHosted.mockReturnValue(true)
    await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:push@forecasts.example.com',
      'test-public-key',
      'test-private-key',
    )
  })

  it('no-ops without throwing when VAPID keys are not configured', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    await expect(
      dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' }),
    ).resolves.toBeUndefined()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('marks the subscription lastUsedAt on a successful send', async () => {
    sendNotification.mockResolvedValueOnce(undefined)

    await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['sub-1'] } } }),
    )
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('prunes the subscription on a 410 Gone without logging an error', async () => {
    sendNotification.mockRejectedValueOnce(new WebPushError(410))

    await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub-1'] } } })
    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each([401, 403])(
    'prunes the subscription and logs loudly on a %d VAPID auth rejection, without retrying',
    async (statusCode) => {
      sendNotification.mockRejectedValueOnce(new WebPushError(statusCode))

      await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })

      expect(sendNotification).toHaveBeenCalledTimes(1)
      expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub-1'] } } })
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: SUB.endpoint, statusCode }),
        expect.stringContaining('VAPID'),
      )
    },
  )

  it('retries a transient failure before giving up and logging an error', async () => {
    sendNotification.mockRejectedValueOnce(new WebPushError(500)).mockResolvedValueOnce(undefined)

    await dispatchBrowserPush('user-1', { title: 't', message: 'm', type: 'SYSTEM' })

    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(deleteMany).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })
})
