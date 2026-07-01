import type { UserRole } from '@prisma/client'

/** Authenticated session user (from NextAuth JWT callback). */
export interface AuthUser {
  id: string
  email: string
  name?: string | null
  image?: string | null
  role: UserRole
  rs: number
}
