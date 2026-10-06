import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore } from 'firebase-admin/firestore'
import { toWebFunction } from './_shared/webFunction'
import { runScheduledWhatsApp } from './_shared/scheduledWhatsApp'

// Noon through 23:00 Singapore time; later runs continue recipients left by the time budget.
export const config = { schedule: '0 4-15 * * *' }

export default toWebFunction(async () => {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) return { statusCode: 503, body: JSON.stringify({ error: 'service-unavailable' }) }
    const account = JSON.parse(raw)
    initializeApp({ projectId: account.project_id, credential: cert(account) })
  }
  const result = await runScheduledWhatsApp(initializeFirestore(getApps()[0], { preferRest: true }))
  return { statusCode: 200, body: JSON.stringify(result) }
})
