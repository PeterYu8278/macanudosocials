import { auth } from '../config/firebase'

interface PublicationNotificationResult {
  success: boolean
  alreadySent?: boolean
  error?: string
}

export const notifyEventPublished = async (eventId: string): Promise<PublicationNotificationResult> => {
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) throw new Error('Please sign in again before publishing the event')

  const response = await fetch('/.netlify/functions/notify-event-published', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ eventId }),
  })

  const responseText = await response.text()
  let result: PublicationNotificationResult
  try {
    result = responseText ? JSON.parse(responseText) : { success: false }
  } catch {
    throw new Error(`Publication notification endpoint returned ${response.status}`)
  }

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to send the event publication notification')
  }

  return result
}
