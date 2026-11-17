import { toWebFunction, type EventHandler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from './_shared/firestoreMonitoring'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { archiveMigrationBatch, previewMigrationCleanup, validMigrationBatch } from './_shared/legacyMigrationMaintenance'

const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
}, body: JSON.stringify(body) })

export const eventHandler: EventHandler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' })
  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
    if (!token) return reply(401, { error: 'Authentication required' })
    const identity = await getAuth().verifyIdToken(token, true)
    const db = getFirestore()
    const operator = (await db.collection(C.USERS).doc(identity.uid).get()).data()
    if (operator?.role !== 'developer' || operator.status === 'suspended') return reply(403, { error: 'Developer access required' })
    const body = JSON.parse(event.body || '{}')
    if (body.action === 'list') {
      const snapshot = await db.collection(C.MIGRATION_BATCHES).limit(1001).get()
      if (snapshot.size > 1000) return reply(400, { error: 'Too many migration batches' })
      const batches = snapshot.docs.filter(document => validMigrationBatch(document.id) && document.data().source === 'legacy_workbook')
        .map(document => ({ id: document.id, fileName: document.data().fileName || document.id }))
      return reply(200, { success: true, batches })
    }
    if (!validMigrationBatch(body.batchId)) return reply(400, { error: 'Invalid migration batch' })
    if (body.action === 'preview') {
      const { records: _records, ...preview } = await previewMigrationCleanup(db, body.batchId)
      return reply(200, { success: true, ...preview })
    }
    if (body.action === 'archive' && body.confirmBatchId === body.batchId) {
      if (body.overwrite === true) {
        if (!Array.isArray(body.phones) || body.phones.length > 5000 || body.phones.some((phone: unknown) => typeof phone !== 'string' || !/^\+\d{8,15}$/.test(phone))) {
          return reply(400, { error: 'Invalid workbook identities' })
        }
        const phones = [...new Set<string>(body.phones)]
        const found = new Set<string>()
        for (let offset = 0; offset < phones.length; offset += 10) {
          const users = await db.collection(C.USERS).where('profile.phone', 'in', phones.slice(offset, offset + 10)).get()
          for (const user of users.docs) {
            const phone = user.data().profile?.phone
            if (found.has(phone)) return reply(409, { error: 'Ambiguous workbook phone identity; no records removed' })
            found.add(phone)
          }
        }
        if (phones.some(phone => !found.has(phone))) return reply(409, { error: 'Import missing workbook users first; no records removed' })
      }
      return reply(200, { success: true, ...await archiveMigrationBatch(db, body.batchId, body.previewToken, identity.uid) })
    }
    return reply(400, { error: 'Invalid action or confirmation' })
  } catch (error) {
    return reply(409, { error: error instanceof Error ? error.message : 'Migration maintenance failed' })
  }
}
export default toWebFunction(eventHandler)
