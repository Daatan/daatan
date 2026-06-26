import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { updateAvatar } from '@/lib/services/user'
import { getStorage } from '@/lib/services/storage'
import sharp from 'sharp'
import { createLogger } from '@/lib/logger'
import crypto from 'crypto'

const log = createLogger('avatar-upload')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const formData = await request.formData()
    const file = formData.get('avatar') as File | null

    if (!file) {
      return apiError('No file provided', 400)
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiError('File must be less than 5MB', 400)
    }

    if (!file.type.startsWith('image/')) {
      return apiError('File must be an image', 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Process image with sharp: 256x256, cover, WebP format
    const processedImage = await sharp(buffer)
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer()

    // Generate unique filename
    const hash = crypto.createHash('sha256').update(user.id + Date.now().toString()).digest('hex').substring(0, 16)
    const key = `avatars/${user.id}/${hash}.webp`

    log.debug({ userId: user.id, key }, 'Uploading avatar')

    // Store via the configured driver (S3 by default; local/MinIO for self-host)
    const avatarUrl = await getStorage().putObject(key, processedImage, {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000', // 1 year cache
    })

    // Update database
    await updateAvatar(user.id, avatarUrl)

    log.info({ userId: user.id, avatarUrl }, 'Avatar updated successfully')

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    return handleRouteError(error, 'Failed to upload avatar')
  }
})
