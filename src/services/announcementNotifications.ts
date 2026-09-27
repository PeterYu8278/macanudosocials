import { auth } from '../config/firebase'

interface PublicationNotificationResult {
  success: boolean
  alreadySent?: boolean
  error?: string
}

export const notifyAnnouncementPublished = async (
  announcementId: string,
): Promise<PublicationNotificationResult> => {
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) throw new Error('Please sign in again before publishing the announcement')

  const response = await fetch('/.netlify/functions/notify-announcement-published', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ announcementId }),
  })

  const responseText = await response.text()
  let result: PublicationNotificationResult
  try {
    result = responseText ? JSON.parse(responseText) : { success: false }
  } catch {
    throw new Error(`Announcement notification endpoint returned ${response.status}`)
  }

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to send the announcement notification')
  }

  return result
}
