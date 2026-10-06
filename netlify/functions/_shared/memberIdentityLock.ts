import { createHash, randomUUID } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS } from '../../../src/config/globalCollections'
import { MemberIdentityError } from './memberIdentity'

// All identity writers use the same keys, including registration and admin creation.
export async function lockMemberIdentity(db: Firestore, keys: string[]) {
  const id = randomUUID()
  const refs = [...new Set(keys)].sort().map(key => db.collection(GLOBAL_COLLECTIONS.MEMBER_IDENTITY_LOCKS)
    .doc(createHash('sha256').update(key).digest('hex')))
  await db.runTransaction(async transaction => {
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)))
    if (snapshots.some(snapshot => (snapshot.data()?.expiresAtMs || 0) > Date.now())) throw new MemberIdentityError('change-busy', 409)
    refs.forEach(ref => transaction.set(ref, { id, expiresAtMs: Date.now() + 120000 }))
  })
  return async () => {
    await db.runTransaction(async transaction => {
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)))
      refs.forEach((ref, index) => { if (snapshots[index].data()?.id === id) transaction.delete(ref) })
    })
  }
}

export async function assertUniqueMemberIdentity(db: Firestore, email: string | undefined, phone: string | undefined, userId?: string) {
  const fields: Array<[string, string, string]> = []
  if (email) fields.push(['email', email, 'email-in-use'])
  if (phone) fields.push(['profile.phone', phone, 'phone-in-use'], ['phone', phone, 'phone-in-use'])
  for (const [field, value, code] of fields) {
    const duplicates = await db.collection(GLOBAL_COLLECTIONS.USERS).where(field, '==', value).limit(2).get()
    if (duplicates.docs.some(document => document.id !== userId)) throw new MemberIdentityError(code, 409)
  }
}
