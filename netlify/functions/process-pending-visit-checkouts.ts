import { toWebFunction } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from './_shared/firestoreMonitoring'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'
import { settlePendingVisitCheckout } from './_shared/pendingVisitCheckout'

const getAdminDb = () => {
  if (!getApps().length) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
  }
  return getFirestore()
}

const processPendingCheckouts = async () => {
  const db = getAdminDb()
  const snapshot = await db.collection(GLOBAL_COLLECTIONS.VISIT_SESSIONS)
    .where('status', '==', 'pending')
    .limit(200)
    .get()

  const userIds = new Set<string>()
  snapshot.docs.forEach(document => {
    const data = document.data()
    if (data.checkoutPending?.status === 'awaiting_reload' && data.userId) userIds.add(data.userId)
  })

  const results = await Promise.allSettled(
    [...userIds].map(userId => settlePendingVisitCheckout(db, userId))
  )
  const completed = results.filter(result => result.status === 'fulfilled' && result.value.status === 'completed').length
  const failed = results.filter(result => result.status === 'rejected').length
  console.log(`[process-pending-visit-checkouts] scanned=${userIds.size} completed=${completed} failed=${failed}`)

  return { statusCode: 200 }
}

export const config = { schedule: '* * * * *' }
export default toWebFunction(processPendingCheckouts)
