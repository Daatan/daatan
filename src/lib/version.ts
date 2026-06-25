import { env } from '@/env'

// Version is read from NEXT_PUBLIC_APP_VERSION which is baked at build time
// by the CI/CD pipeline. This ensures that the client and server always
// have the same version reported.
export const VERSION = env.NEXT_PUBLIC_APP_VERSION || 'unknown' // v1.18.10
