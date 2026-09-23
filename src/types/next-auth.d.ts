import 'next-auth'
import type { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      username?: string | null
      role: UserRole
      rs?: number
      eloRating?: number
    }
  }

  interface User {
    id: string
    username?: string | null
    role: UserRole
    rs?: number
    eloRating?: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub: string
    role?: UserRole
    username?: string | null
    rs?: number
    eloRating?: number
    /** Date.now() ms when the DB data was last fetched */
    cachedAt?: number
    /** Set to true when the user was not found in DB */
    userDeleted?: boolean
  }
}

