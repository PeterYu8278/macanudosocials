import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { loadWhatsApp, submitWhapi, submitWhapiButtons } from './_shared/whatsapp'
import { encryptRegistrationPassword, maskEmail, registrationTokenHash, validateRegistrationEmail, type WhatsAppRegistrationSession } from './_shared/whatsappRegistration'
import { toWebFunction, type EventHandler } from './_shared/webFunction'

const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
const DEFAULT_APP_LOGO_URL = 'https://res.cloudinary.com/kcwja8y0/image/upload/v1789926866/macanudo_socials/app-config/cropped-image_1789926865771_1789926865771_uiei5t4w8jk.png'
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const page = (title: string, body: string, logoUrl = DEFAULT_APP_LOGO_URL) => `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#171612;color:#f8e6aa;margin:0;padding:20px;min-height:100vh;display:grid;place-items:center}main{width:min(100%,460px);background:#24221d;border:1px solid #9c7629;border-radius:14px;padding:clamp(22px,6vw,36px);box-shadow:0 18px 50px #0008}.brand{text-align:center;margin:0 0 22px;background:transparent}.brand img{width:auto;height:79px;max-width:100%;object-fit:contain;background:transparent;display:block;margin:0 auto}.actions{display:flex;gap:10px;margin-top:20px}.actions a{flex:1;text-decoration:none}.actions button{margin-top:0;padding-left:8px;padding-right:8px}h1{font-size:clamp(24px,7vw,32px);line-height:1.15;margin:0 0 12px;color:#ffe28c}p{line-height:1.6;color:#ddd5c4;margin:10px 0}small{display:block;color:#aaa294;line-height:1.5;margin-top:12px}form{margin-top:22px}label{display:block;margin:16px 0 7px;color:#f1eee7;font-weight:650}input,button{width:100%;min-height:48px;padding:13px 14px;border-radius:9px;border:1px solid #8f6b29;font-size:16px}input{background:#34322d;color:#fff;outline:none}input:focus{border-color:#f2c85c;box-shadow:0 0 0 3px #f2c85c2e}button{margin-top:24px;background:#f0c65f;color:#211b0d;font-weight:750;cursor:pointer}button:hover{background:#ffda76}@media(max-width:420px){body{padding:12px}main{padding:22px 18px;border-radius:12px}.actions{flex-direction:column}}</style><main><div class="brand"><img src="${escapeHtml(logoUrl)}" alt="App Logo"></div>${body}</main>`

async function loadAppLogo(db: any) {
  const data = (await db.collection(C.APP_CONFIG).doc('default').get()).data()
  return typeof data?.logoUrl === 'string' && data.logoUrl.trim() ? data.logoUrl.trim() : DEFAULT_APP_LOGO_URL
}

function init() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('service-unavailable')
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    initializeApp({ projectId: account.project_id, credential: cert(account) })
  }
  return initializeFirestore(getApps()[0], { preferRest: true })
}

async function loadSession(db: any, token: string) {
  const snapshot = await db.collection(C.WHATSAPP_REGISTRATION_SESSIONS)
    .where('registrationTokenHash', '==', registrationTokenHash(token)).limit(1).get()
  const document = snapshot.docs[0]
  if (!document) return null
  const data = document.data() as WhatsAppRegistrationSession
  if (data.step !== 'awaiting-form' || data.expiresAtMs <= Date.now()) return null
  return { ref: document.ref, data }
}

const response = (statusCode: number, body: string) => ({ statusCode, headers: htmlHeaders, body })
const normalizeReferralCode = (value: string | null) => value && /^[A-Z0-9]{6}$/i.test(value) ? value.toUpperCase() : ''
const recoveryBody = (referralCode = '', title = 'Registration link invalid') => {
  const command = referralCode ? `/register ${referralCode}` : '/register'
  const encodedCommand = encodeURIComponent(command)
  return `<div class="error-page" style="text-align:center"><h1>${title}</h1><div class="actions"><a href="whatsapp://send?text=${encodedCommand}"><button type="button">Return to WhatsApp</button></a><a href="https://wa.me/?text=${encodedCommand}"><button type="button">Register again</button></a></div></div>`
}

export const eventHandler: EventHandler = async event => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, 'Method not allowed')
  try {
    const requestUrl = event.rawUrl ? new URL(event.rawUrl) : null
    const rawToken = event.queryStringParameters?.token || ''
    const token = rawToken || requestUrl?.searchParams.get('token') || ''
    const referralCode = normalizeReferralCode(event.queryStringParameters?.ref || requestUrl?.searchParams.get('ref') || null)
    if (!/^[a-f0-9]{64}$/.test(token)) return response(400, page('Registration link invalid', recoveryBody(referralCode), DEFAULT_APP_LOGO_URL))
    const db = init()
    let logoUrl = DEFAULT_APP_LOGO_URL
    try { logoUrl = await loadAppLogo(db) } catch { /* Keep the configured public fallback logo. */ }
    const session = await loadSession(db, token)
    if (!session) return response(410, page('Registration link expired', recoveryBody(referralCode, 'Registration link expired'), logoUrl))
    if (event.httpMethod === 'GET') return response(200, page('Register for Macanudo Socials', '<h1>Register for Macanudo Socials</h1><p>Enter your name, email, and login password.</p><small>请填写姓名、Email 和登录密码。</small><form method="post"><label for="name">Name</label><input id="name" name="name" required minlength="2" maxlength="128" autocomplete="name"><label for="email">Email</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="6" maxlength="128" autocomplete="new-password"><label for="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" required minlength="6" maxlength="128" autocomplete="new-password"><button type="submit">Submit registration</button></form>', logoUrl))
    const form = new URLSearchParams(event.body || '')
    const name = (form.get('name') || '').trim()
    const email = validateRegistrationEmail(form.get('email') || '')
    const password = form.get('password') || ''
    const confirmPassword = form.get('confirmPassword') || ''
    if (name.length < 2 || name.length > 128 || !email || password.length < 6 || password.length > 128 || password !== confirmPassword) return response(400, page('Invalid registration details', '<h1>Invalid registration details</h1><p>Please check your name, email, and password. Passwords must match and contain at least 6 characters.</p><small>请确认姓名、Email 和两次密码输入正确，密码至少 6 位。</small>', logoUrl))
    await session.ref.set({ ...session.data, displayName: name, email, passwordCiphertext: encryptRegistrationPassword(password), step: 'awaiting-final-confirm', updatedAt: Timestamp.now() })
    const whatsapp = await loadWhatsApp(db)
    const confirmation = `Welcome to Macanudo Socials. Please confirm your registration details:\nName: ${name}\nPhone: ${session.data.phone}\nEmail: ${email}${session.data.referralCode ? `\nReferral code: ${session.data.referralCode}` : ''}`
    const result = await submitWhapiButtons(whatsapp.token, session.data.phone, confirmation)
    if (result.status !== 'accepted') await submitWhapi(whatsapp.token, session.data.phone, `${confirmation}\n\nReply CONFIRM to continue or CANCEL to cancel.`)
    const whatsappPhone = session.data.phone.replace(/\D/g, '')
    const returnText = encodeURIComponent('Details submitted. Return to this chat and tap Confirm to continue.')
    const appUrl = `whatsapp://send?phone=${whatsappPhone}&text=${returnText}`
    const webUrl = `https://wa.me/${whatsappPhone}?text=${returnText}`
    const returnPage = `<h1>Details submitted</h1><p>Your registration details were sent to WhatsApp. Click <strong>Confirm</strong> to finish registration.</p><p>Email: ${escapeHtml(maskEmail(email))}</p><a id="return-whatsapp" href="${escapeHtml(webUrl)}"><button type="button">Return to WhatsApp</button></a><script>setTimeout(function(){window.location.href=${JSON.stringify(appUrl)};setTimeout(function(){window.location.href=${JSON.stringify(webUrl)}},1200)},150)</script>`
    return response(200, page('Details submitted', returnPage, logoUrl))
  } catch {
    return response(503, page('Registration unavailable', '<h1>Registration unavailable</h1><p>Please try again later by sending <strong>/register</strong> in WhatsApp.</p><small>暂时无法处理，请稍后重新发送 /register。</small>'))
  }
}

export default toWebFunction(eventHandler)
