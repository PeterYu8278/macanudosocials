// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate, updateDoc } from 'firebase/firestore'

const enabled = process.env.FIRESTORE_RULES_TEST_HOST === '127.0.0.1:8089'
const project = 'demo-dashboard-visit-stats'
const base = `http://127.0.0.1:8089/v1/projects/${project}/databases/(default)/documents`
const clients: Array<ReturnType<typeof getFirestore>> = []
const text = (value: string) => ({ stringValue: value })
async function seed(path: string, fields: Record<string, any>) {
  const response = await fetch(`${base}/${path}`, { method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
  if (!response.ok) throw new Error('Emulator seed failed')
}
function client(uid: string) {
  const app = initializeApp({ projectId: project, apiKey: 'emulator-only' }, `${uid}-${clients.length}`)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8089, { mockUserToken: { sub: uid } })
  clients.push(db)
  return db
}
describe.runIf(enabled)('Dashboard summary scope rules (isolated local emulator)', () => {
  beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Emulator reset failed')
    for (const role of ['storeAdmin', 'admin', 'superAdmin', 'developer', 'member']) {
      await seed(`users/${role}`, { role: text(role), storeId: text('a') })
    }
    for (const scope of ['all', 'store_a', 'store_b']) {
      await seed(`_dashboardVisitStats/${scope}`, { version: { integerValue: '1' } })
      await seed(`_dashboardVisitStats/${scope}/buckets/daily_2026-10-18`, { count: { integerValue: '2' } })
      await seed(`_dashboardRedemptionStats/${scope}/buckets/hour_2026-10-18T16`, { count: { integerValue: '5' } })
    }
    await seed('_visitMemberStats/member', { userId: text('member'), completedHours: { doubleValue: 2 } })
  })
  afterAll(async () => { for (const db of clients) { await terminate(db); await deleteApp(db.app) } })
  it.each(['storeAdmin', 'admin'])('allows %s to get only assigned-store counts', async role => {
    const db = client(role)
    for (const suffix of ['', '/buckets/daily_2026-10-18']) {
      await expect(getDoc(doc(db, `_dashboardVisitStats/store_a${suffix}`))).resolves.toBeDefined()
      for (const scope of ['all', 'store_b']) {
        await expect(getDoc(doc(db, `_dashboardVisitStats/${scope}${suffix}`))).rejects.toMatchObject({ code: 'permission-denied' })
      }
    }
  })
  it.each(['superAdmin', 'developer'])('allows global role %s to read all count scopes', async role => {
    const db = client(role)
    for (const scope of ['all', 'store_a', 'store_b']) await expect(getDoc(doc(db, `_dashboardVisitStats/${scope}`))).resolves.toBeDefined()
  })
  it('denies members access to Dashboard counts and denies all client projection writes', async () => {
    await expect(getDoc(doc(client('member'), '_dashboardVisitStats/store_a'))).rejects.toMatchObject({ code: 'permission-denied' })
    const db = client('developer')
    await expect(setDoc(doc(db, '_dashboardVisitStats/store_a'), { count: 99 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_dashboardVisitStatsSources/s'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, '_dashboardVisitStatsMeta/default'), { ready: true })).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('allows member-owned stats reads but denies other owners, writes and private checkpoints', async () => {
    const db = client('member')
    await expect(getDoc(doc(db, '_visitMemberStats/member'))).resolves.toBeDefined()
    await expect(getDoc(doc(db, '_visitMemberStats/other'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, '_visitMemberStats/member'), { completedHours: 99 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_visitMemberStatsSources/s'))).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('does not let a store administrator change their assignment to bypass summary scope', async () => {
    const db = client('storeAdmin')
    await expect(updateDoc(doc(db, 'users/storeAdmin'), { storeId: 'b' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_dashboardVisitStats/store_b'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(updateDoc(doc(db, 'users/storeAdmin'), { displayName: 'Updated profile' })).resolves.toBeUndefined()
    await expect(getDoc(doc(db, '_dashboardVisitStats/store_a'))).resolves.toBeDefined()
  })
  it('keeps privileged store assignment available', async () => {
    await expect(updateDoc(doc(client('developer'), 'users/storeAdmin'), { storeId: 'b' })).resolves.toBeUndefined()
    await expect(getDoc(doc(client('storeAdmin'), '_dashboardVisitStats/store_b'))).resolves.toBeDefined()
  })
  it('isolates cigar redemption buckets by store and forbids client changes', async () => {
    const db = client('storeAdmin')
    await expect(getDoc(doc(db, '_dashboardRedemptionStats/store_a/buckets/hour_2026-10-18T16'))).resolves.toBeDefined()
    await expect(getDoc(doc(db, '_dashboardRedemptionStats/store_b/buckets/hour_2026-10-18T16'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_dashboardRedemptionStats/all/buckets/hour_2026-10-18T16'))).rejects.toMatchObject({ code: 'permission-denied' })
    const global = client('developer')
    await expect(getDoc(doc(global, '_dashboardRedemptionStats/all/buckets/hour_2026-10-18T16'))).resolves.toBeDefined()
    await expect(setDoc(doc(global, '_dashboardRedemptionStats/all/buckets/hour_2026-10-18T16'), { count: 99 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(global, '_dashboardRedemptionStatsMeta/default'), { ready: true })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(global, '_dashboardRedemptionStatsSources/s'))).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
