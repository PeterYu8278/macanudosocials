import { getDocument } from './firestore'
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections'
import type { User } from '../../types'

export const getUserDisplayNames = async (userIds: readonly (string | undefined)[]): Promise<Record<string, string>> => {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
  const entries = await Promise.all(ids.map(async id => {
    try {
      const user = await getDocument<User>(GLOBAL_COLLECTIONS.USERS, id)
      return [id, user?.displayName?.trim() || ''] as const
    } catch {
      return [id, ''] as const
    }
  }))
  return Object.fromEntries(entries)
}
