import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const connectionError = (code: string, status = 409) => Object.assign(new Error(code), { code, status })
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex')
function key() {
  const value = process.env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY || ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw connectionError('encryption-key-missing', 503)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) throw connectionError('encryption-key-missing', 503)
  return decoded
}
export function credentialEncryptionReady() {
  try { key(); return true } catch { return false }
}
export function encryptWhatsAppToken(token: string, channelId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(`whapi:v1:${channelId}`))
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}
export function decryptWhatsAppToken(value: string, channelId: string) {
  try {
    const [version, iv, tag, body, extra] = value.split('.')
    if (version !== 'v1' || extra || !iv || !tag || !body) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
    decipher.setAAD(Buffer.from(`whapi:v1:${channelId}`))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
  } catch { throw connectionError('credentials-invalid', 503) }
}

export function resolveWhatsAppCredentials(saved: any, secret: any, legacy: any) {
  const managed = saved?.credentialMode === 'managed'
  let token = '', invalid = false
  const source = managed ? 'managed' : process.env.WHAPI_API_TOKEN ? 'environment' : secret?.whapiToken ? 'database-legacy' : 'legacy-config'
  if (managed) {
    try {
      if (!secret?.ciphertext || secret.version !== saved.credentialVersion || secret.channelId !== saved.config?.whapi?.channelId) throw new Error()
      token = decryptWhatsAppToken(secret.ciphertext, secret.channelId)
      if (!token || secret.tokenHash !== tokenDigest(token)) throw new Error()
    } catch { token = ''; invalid = true }
  } else token = process.env.WHAPI_API_TOKEN || secret?.whapiToken || legacy?.apiToken || ''
  const channelId = saved?.config?.whapi?.channelId || legacy?.channelId || ''
  const tokenHash = tokenDigest(token)
  const credentialVersion = managed ? saved.credentialVersion : `legacy-${tokenHash}`
  return { token, tokenHash, credentialVersion, credentialSource: source, managed, credentialsInvalid: invalid,
    binding: tokenDigest(JSON.stringify([channelId, credentialVersion, tokenHash])) }
}
