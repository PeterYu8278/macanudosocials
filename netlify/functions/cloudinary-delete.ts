import { createHash } from 'crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const response = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
})

const initializeAdmin = () => {
  if (getApps().length) return
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
}

const verifyCaller = async (authorization?: string) => {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) throw new Error('UNAUTHENTICATED')
  initializeAdmin()
  await getAuth().verifyIdToken(token)
}

export const eventHandler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {})
  if (event.httpMethod !== 'POST') return response(405, { success: false, error: 'Method not allowed' })

  try {
    await verifyCaller(event.headers['authorization'])
  } catch {
    return response(401, { success: false, error: 'Unauthorized' })
  }

  let publicId: string
  let resourceType = 'image'
  let invalidate = false

  try {
    const body = JSON.parse(event.body || '{}')
    publicId = body.publicId
    if (body.resourceType) resourceType = body.resourceType
    if (body.invalidate) invalidate = true
  } catch {
    return response(400, { success: false, error: 'Invalid request body' })
  }

  if (!publicId) {
    return response(400, { success: false, error: 'publicId is required' })
  }

  const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.VITE_CLOUDINARY_API_KEY
  const apiSecret = process.env.VITE_CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    return response(500, { success: false, error: 'Cloudinary configuration missing on server' })
  }

  const timestamp = Math.round(Date.now() / 1000)

  const params: Record<string, string> = { public_id: publicId, timestamp: timestamp.toString() }
  if (invalidate) params.invalidate = 'true'

  const sortedKeys = Object.keys(params).sort()
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + apiSecret
  const signature = createHash('sha1').update(stringToSign).digest('hex')

  const formData = new URLSearchParams()
  sortedKeys.forEach(k => formData.append(k, params[k]))
  formData.append('api_key', apiKey)
  formData.append('signature', signature)

  try {
    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
      { method: 'POST', body: formData }
    )
    const result = await cloudinaryRes.json() as { result?: string; error?: { message: string } }

    if (!cloudinaryRes.ok) {
      return response(cloudinaryRes.status, {
        success: false,
        error: result.error?.message || 'Cloudinary delete failed',
      })
    }

    return response(200, { success: true, result: result.result, public_id: publicId })
  } catch (err) {
    return response(500, { success: false, error: err instanceof Error ? err.message : 'Cloudinary request failed' })
  }
}

export const handler = toWebFunction(eventHandler)
