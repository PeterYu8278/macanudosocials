// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { lockMemberIdentity } from '../functions/_shared/memberIdentityLock'
function database() {
  const documents = new Map<string, any>()
  let pending = Promise.resolve()
  const db = { collection: () => ({ doc: (id: string) => ({ id }) }), runTransaction: (callback: any) => {
    const result = pending.then(() => callback({
      get: async (ref: any) => ({ data: () => documents.get(ref.id) }),
      set: (ref: any, value: any) => documents.set(ref.id, value), delete: (ref: any) => documents.delete(ref.id),
    }))
    pending = result.then(() => {}, () => {})
    return result
  } } as unknown as Firestore
  return { db, documents }
}
describe('shared identity locks', () => {
  it('prevents competing writes for the same account even with different phone values', async () => {
    const { db } = database()
    const results = await Promise.allSettled([lockMemberIdentity(db, ['uid:member', 'phone:A']), lockMemberIdentity(db, ['uid:member', 'phone:B'])])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'change-busy' } })
    for (const result of results) if (result.status === 'fulfilled') await result.value()
    await expect(lockMemberIdentity(db, ['uid:member', 'phone:B'])).resolves.toBeTypeOf('function')
  })
  it('prevents registration and an admin update claiming the same phone', async () => {
    const { db } = database()
    const release = await lockMemberIdentity(db, ['email:new@example.com', 'phone:A'])
    await expect(lockMemberIdentity(db, ['uid:other', 'phone:A'])).rejects.toMatchObject({ code: 'change-busy' })
    await release()
    await expect(lockMemberIdentity(db, ['uid:other', 'phone:A'])).resolves.toBeTypeOf('function')
  })
  it('does not remove a newer lease when releasing an expired one', async () => {
    const { db, documents } = database()
    const oldRelease = await lockMemberIdentity(db, ['uid:member'])
    for (const [id, value] of documents) documents.set(id, { ...value, expiresAtMs: 0 })
    const newRelease = await lockMemberIdentity(db, ['uid:member'])
    await oldRelease()
    await expect(lockMemberIdentity(db, ['uid:member'])).rejects.toMatchObject({ code: 'change-busy' })
    await newRelease()
  })
})
