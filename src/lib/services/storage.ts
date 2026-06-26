import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'
import path from 'path'
import { env } from '@/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('storage')

const REGION = process.env.AWS_REGION || 'eu-central-1'
const DEFAULT_LOCAL_PATH = '/data/uploads'

export interface PutObjectOptions {
  contentType: string
  /** Cache-Control header for object stores; ignored by the local driver. */
  cacheControl?: string
}

export interface StorageDriver {
  /** Store an object under `key` and return its publicly accessible URL. */
  putObject(key: string, body: Buffer, opts: PutObjectOptions): Promise<string>
}

/** Thrown when the selected storage driver is missing required configuration. */
export class StorageConfigError extends Error {}

/**
 * Resolve the uploads bucket name. Preserves the prior avatar-route behavior:
 * prefer UPLOADS_BUCKET_NAME, else construct it from APP_ENV + AWS_ACCOUNT_ID
 * following the Terraform naming convention.
 */
function resolveBucket(): string | null {
  if (env.UPLOADS_BUCKET_NAME) return env.UPLOADS_BUCKET_NAME

  const appEnv = process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'staging'
  const mappedEnv = appEnv === 'next' ? 'staging' : appEnv
  const accountId = process.env.AWS_ACCOUNT_ID
  if (accountId) return `daatan-uploads-${mappedEnv}-${accountId}`

  return null
}

/**
 * S3 / S3-compatible driver. `endpoint` is null for AWS S3 (virtual-hosted URLs,
 * byte-identical to the legacy avatar route) and set for MinIO (path-style URLs).
 */
class S3StorageDriver implements StorageDriver {
  constructor(
    private readonly client: S3Client,
    private readonly endpoint: string | null,
  ) {}

  async putObject(key: string, body: Buffer, opts: PutObjectOptions): Promise<string> {
    const bucket = resolveBucket()
    if (!bucket) {
      throw new StorageConfigError(
        'Uploads bucket is not configured (set UPLOADS_BUCKET_NAME or AWS_ACCOUNT_ID)'
      )
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
      })
    )

    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, '')}/${bucket}/${key}`
    }
    return `https://${bucket}.s3.${REGION}.amazonaws.com/${key}`
  }
}

/**
 * Filesystem driver for self-hosted installs without object storage. Objects are
 * written under STORAGE_LOCAL_PATH and served back via /api/uploads/[...path].
 * Returns a relative URL so it works behind any ingress/domain.
 */
class LocalStorageDriver implements StorageDriver {
  async putObject(key: string, body: Buffer): Promise<string> {
    const base = env.STORAGE_LOCAL_PATH || DEFAULT_LOCAL_PATH
    const dest = path.join(base, key)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, body)
    log.debug({ key, dest }, 'Stored object on local filesystem')
    return `/api/uploads/${key}`
  }
}

/**
 * Return the configured storage driver. Defaults to S3 (preserving SaaS
 * behavior) — note an unset STORAGE_DRIVER falls through to the `default` case,
 * which matters in tests where SKIP_ENV_VALIDATION bypasses the zod default.
 */
export function getStorage(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageDriver()
    case 'minio': {
      const endpoint = env.S3_ENDPOINT
      if (!endpoint) {
        throw new StorageConfigError('STORAGE_DRIVER=minio requires S3_ENDPOINT')
      }
      return new S3StorageDriver(
        new S3Client({ region: REGION, endpoint, forcePathStyle: true }),
        endpoint
      )
    }
    case 's3':
    default:
      return new S3StorageDriver(new S3Client({ region: REGION }), null)
  }
}
