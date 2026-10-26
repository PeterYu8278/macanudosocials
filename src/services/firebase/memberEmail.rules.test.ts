// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp } from 'firebase/app'
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, query, setDoc, terminate, updateDoc, where } from 'firebase/firestore'

// Opt in only against the isolated local emulator; never accept a production host.
const enabled = process.env.FIRESTORE_RULES_TEST_HOST === '127.0.0.1:8089'
const project = 'demo-member-email'
const base = `http://127.0.0.1:8089/v1/projects/${project}/databases/(default)/documents`
const clients: Array<ReturnType<typeof getFirestore>> = []
function client(uid: string, email = `${uid}@example.com`) {
  const app = initializeApp({ projectId: project, apiKey: 'emulator-only' }, `${uid}-${clients.length}`)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8089, { mockUserToken: { sub: uid, email } })
  clients.push(db)
  return db
}
async function seed(id: string, fields: Record<string, any>) {
  const response = await fetch(`${base}/users/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
  if (!response.ok) throw new Error(`Emulator seed failed: ${await response.text()}`)
}
const text = (value: string) => ({ stringValue: value })

describe.runIf(enabled)('member identity Firestore rules (local emulator)', () => {
  beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Emulator reset failed')
    await seed('member', { email: text('member@example.com'), role: text('member'), displayName: text('Member'), authUid: text('member') })
    await seed('operator', { email: text('operator@example.com'), role: text('admin') })
  })
  afterAll(async () => {
    for (const db of clients) { await terminate(db); await deleteApp(db.app) }
  })
  it('allows ordinary member profile edits but denies client changes to identity mappings and audit fields', async () => {
    const db = client('member')
    await expect(updateDoc(doc(db, 'users/member'), { displayName: 'Edited' })).resolves.toBeUndefined()
    for (const field of ['authUid', 'emailAuth', 'emailChange']) {
      await expect(updateDoc(doc(db, 'users/member'), { [field]: 'forged' })).rejects.toMatchObject({ code: 'permission-denied' })
    }
    for (const field of ['profile.phone', 'profile.phoneAuth', 'phone']) {
      await expect(updateDoc(doc(db, 'users/member'), { [field]: 'forged' })).rejects.toMatchObject({ code: 'permission-denied' })
    }
  })
  it('denies administrator bypass of the email backend', async () => {
    const db = client('operator')
    await expect(updateDoc(doc(db, 'users/member'), { displayName: 'Edited by admin' })).resolves.toBeUndefined()
    await expect(updateDoc(doc(db, 'users/member'), { email: 'unverified@example.com' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(updateDoc(doc(db, 'users/member'), { authUid: 'operator' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(updateDoc(doc(db, 'users/member'), { 'profile.phone': '+60123456789' })).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('allows user deletion only for superAdmin and developer', async () => {
    for (const role of ['member', 'storeAdmin', 'admin', 'superAdmin', 'developer']) {
      await seed(`delete-${role}`, { role: text(role) })
      await seed(`target-${role}`, { role: text('member') })
      const operation = deleteDoc(doc(client(`delete-${role}`), `users/target-${role}`))
      if (role === 'superAdmin' || role === 'developer') {
        await expect(operation).resolves.toBeUndefined()
      } else {
        await expect(operation).rejects.toMatchObject({ code: 'permission-denied' })
      }
    }
  })
  it('allows only the authenticated email to be written by a member', async () => {
    const db = client('member')
    await expect(updateDoc(doc(db, 'users/member'), { email: 'other@example.com' })).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('reads and updates a mapped legacy document after Auth email changed', async () => {
    await seed('legacy', { email: text('old@example.com'), authUid: text('legacy-auth'), role: text('member') })
    const db = client('legacy-auth', 'new@example.com')
    expect((await getDoc(doc(db, 'users/legacy'))).exists()).toBe(true)
    const matches = await getDocs(query(collection(db, 'users'), where('authUid', '==', 'legacy-auth')))
    expect(matches.docs.map(document => document.id)).toEqual(['legacy'])
    await expect(updateDoc(doc(db, 'users/legacy'), { displayName: 'Legacy member' })).resolves.toBeUndefined()
    await expect(getDoc(doc(db, 'users/member'))).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('denies forged mappings or audit state during registration', async () => {
    const db = client('new-member')
    const member = { email: 'new-member@example.com', role: 'guest', status: 'inactive', membership: { points: 0 } }
    await expect(setDoc(doc(db, 'users/new-member'), { ...member, authUid: 'member' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'users/new-member'), { ...member, emailChange: {} })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'users/new-member'), { ...member, profile: { phone: '+60123456789' } })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'users/new-member'), member)).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('denies forged manual packages and completed reload records', async () => {
    const db = client('member')
    const pending = { userId: 'member', requestedAmount: 100, pointsEquivalent: 100, status: 'pending', billplzId: 'bill' }
    await expect(setDoc(doc(db, 'reloadRecords/online'), pending)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'reloadRecords/online-net'), { ...pending, pointsEquivalentBasis: 'net', annualFeeAmount: 0 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'reloadRecords/forged-fee'), { ...pending, annualFeeAmount: 199 }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'reloadRecords/forged-package'), { ...pending, membershipOrderId: 'forged' }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'reloadRecords/forged-completed'), { ...pending, status: 'completed' }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, 'reloadRecords/forged-amount'), { ...pending, pointsEquivalent: 500 }))
      .rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('requires server review and preserves pending reload audit records', async () => {
    const db = client('member')
    const response = await fetch(`${base}/reloadRecords/pending`, { method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { userId: text('member'), status: text('pending'), billplzId: text('bill') } }) })
    expect(response.ok).toBe(true)
    await expect(updateDoc(doc(client('operator'), 'reloadRecords/pending'), { status: 'completed' }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(deleteDoc(doc(db, 'reloadRecords/pending'))).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('allows only the owner to query safe payment statuses and never exposes private orders', async () => {
    for (const name of ['_membershipPaymentStatuses', '_membershipPayments']) {
      const response = await fetch(`${base}/${name}/payment`, { method: 'PATCH',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { userId: text('member'), status: text('pending') } }) })
      if (!response.ok) throw new Error('Payment seed failed')
    }
    const db = client('member')
    const rows = await getDocs(query(collection(db, '_membershipPaymentStatuses'), where('userId', '==', 'member'), where('status', 'in', ['creating', 'pending'])))
    expect(rows.size).toBe(1)
    await expect(getDoc(doc(client('operator'), '_membershipPaymentStatuses/payment'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_membershipPayments/payment'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(updateDoc(doc(db, '_membershipPaymentStatuses/payment'), { status: 'fulfilled' })).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('allows owners to read trusted counters but never forge them or access checkpoints', async () => {
    const response = await fetch(`${base}/_redemptionStats/member`, { method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { version: { integerValue: '1' }, completedQuantity: { integerValue: '2' }, pendingQuantity: { integerValue: '1' } } }) })
    if (!response.ok) throw new Error('Stats seed failed')
    const db = client('member')
    expect((await getDoc(doc(db, '_redemptionStats/member'))).data()?.completedQuantity).toBe(2)
    await expect(getDoc(doc(db, '_redemptionStats/other'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, '_redemptionStats/member'), { completedQuantity: 0, pendingQuantity: 0 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(client('operator'), '_redemptionStats/member'), { completedQuantity: 99 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(getDoc(doc(db, '_redemptionStatsSources/session'))).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
