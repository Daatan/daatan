import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

// Mutable mock env so each test can pick a driver; storage.ts reads it lazily.
const { mockEnv, mockS3Send } = vi.hoisted(() => ({
  mockEnv: {
    STORAGE_DRIVER: undefined as string | undefined,
    S3_ENDPOINT: undefined as string | undefined,
    STORAGE_LOCAL_PATH: undefined as string | undefined,
    UPLOADS_BUCKET_NAME: undefined as string | undefined,
  },
  mockS3Send: vi.fn(),
}))

vi.mock('@/env', () => ({ env: mockEnv }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockS3Send
  },
  PutObjectCommand: class {
    constructor(public args: unknown) {}
  },
}))

import { getStorage, StorageConfigError } from '@/lib/services/storage'

const tmpRoot = path.join(os.tmpdir(), 'daatan-storage-test')

describe('storage drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.STORAGE_DRIVER = undefined
    mockEnv.S3_ENDPOINT = undefined
    mockEnv.STORAGE_LOCAL_PATH = undefined
    mockEnv.UPLOADS_BUCKET_NAME = undefined
    delete process.env.AWS_ACCOUNT_ID
    delete process.env.APP_ENV
    mockS3Send.mockResolvedValue({})
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  const opts = { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' }

  it('s3 driver (default) returns a virtual-hosted AWS URL, byte-identical to legacy', async () => {
    mockEnv.UPLOADS_BUCKET_NAME = 'daatan-uploads-prod-272007598366'
    const url = await getStorage().putObject('avatars/u1/abc.webp', Buffer.from('x'), opts)
    expect(url).toBe(
      'https://daatan-uploads-prod-272007598366.s3.eu-central-1.amazonaws.com/avatars/u1/abc.webp'
    )
    expect(mockS3Send).toHaveBeenCalledTimes(1)
  })

  it('s3 driver constructs the bucket name from APP_ENV + AWS_ACCOUNT_ID when unset', async () => {
    process.env.APP_ENV = 'staging'
    process.env.AWS_ACCOUNT_ID = '123456789012'
    const url = await getStorage().putObject('avatars/u1/abc.webp', Buffer.from('x'), opts)
    expect(url).toBe(
      'https://daatan-uploads-staging-123456789012.s3.eu-central-1.amazonaws.com/avatars/u1/abc.webp'
    )
  })

  it('s3 driver throws StorageConfigError when no bucket can be resolved', async () => {
    await expect(
      getStorage().putObject('avatars/u1/abc.webp', Buffer.from('x'), opts)
    ).rejects.toBeInstanceOf(StorageConfigError)
  })

  it('minio driver returns a path-style URL against the custom endpoint', async () => {
    mockEnv.STORAGE_DRIVER = 'minio'
    mockEnv.S3_ENDPOINT = 'http://minio:9000/'
    mockEnv.UPLOADS_BUCKET_NAME = 'uploads'
    const url = await getStorage().putObject('avatars/u1/abc.webp', Buffer.from('x'), opts)
    expect(url).toBe('http://minio:9000/uploads/avatars/u1/abc.webp')
    expect(mockS3Send).toHaveBeenCalledTimes(1)
  })

  it('minio driver requires S3_ENDPOINT', () => {
    mockEnv.STORAGE_DRIVER = 'minio'
    expect(() => getStorage()).toThrow(StorageConfigError)
  })

  it('local driver writes to disk and returns a relative /api/uploads URL', async () => {
    mockEnv.STORAGE_DRIVER = 'local'
    mockEnv.STORAGE_LOCAL_PATH = tmpRoot
    const body = Buffer.from('local-image-bytes')
    const url = await getStorage().putObject('avatars/u1/abc.webp', body, opts)
    expect(url).toBe('/api/uploads/avatars/u1/abc.webp')
    const written = await fs.readFile(path.join(tmpRoot, 'avatars/u1/abc.webp'))
    expect(written.equals(body)).toBe(true)
    expect(mockS3Send).not.toHaveBeenCalled()
  })
})
