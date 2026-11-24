/** Username (and profile path, `/profile/daatan`) of the account admins publish as (#2301). */
export const DAATAN_USERNAME = 'daatan'

/**
 * Nobody else may take the Daatan account's username or slug, in any case. The account itself
 * is created lazily on the first "publish as Daatan", so until then nothing in the database
 * holds the name: signup and the profile form must refuse it on their own.
 */
export function isReservedUsername(name: string): boolean {
  return name.toLowerCase() === DAATAN_USERNAME
}

/** The Daatan account itself: the name is reserved, so only the system user can hold it. */
export function isDaatanAccount(user: { username?: string | null }): boolean {
  return user.username === DAATAN_USERNAME
}
