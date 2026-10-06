import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { loadWhatsApp, submitWhapi, submitWhapiButtons } from './_shared/whatsapp'
import { encryptRegistrationPassword, maskEmail, registrationTokenHash, validateRegistrationEmail, type WhatsAppRegistrationSession } from './_shared/whatsappRegistration'
import { toWebFunction, type EventHandler } from './_shared/webFunction'

const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
const DEFAULT_APP_LOGO_URL = 'https://res.cloudinary.com/kcwja8y0/image/upload/v1789926866/macanudo_socials/app-config/cropped-image_1789926865771_1789926865771_uiei5t4w8jk.png'
const DEFAULT_WHAPI_USER_ID = '601157288278'
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const page = (title: string, body: string, logoUrl = DEFAULT_APP_LOGO_URL) => `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#171612;color:#f8e6aa;margin:0;padding:clamp(16px,5vh,40px) 16px;min-height:100vh;display:flex;align-items:flex-start;justify-content:center}.centered-page{align-items:center}main{width:min(100%,520px);background:#24221d;border:1px solid #9c7629;border-radius:16px;padding:clamp(22px,5vw,34px);box-shadow:0 18px 50px #0008}.brand{text-align:center;margin:0 0 18px;background:transparent}.brand img{width:auto;height:88px;max-width:100%;object-fit:contain;background:transparent;display:block;margin:0 auto}.intro{border-top:1px solid #8f6b294d;padding-top:18px}h1{font-size:clamp(28px,6vw,36px);line-height:1.12;letter-spacing:-.01em;margin:0 0 10px;color:#ffe28c}p{line-height:1.5;color:#ddd5c4;margin:8px 0}.intro p{font-size:16px}small{display:block;color:#aaa294;line-height:1.45;margin-top:8px}form{margin-top:20px}.field{display:grid;grid-template-columns:128px minmax(0,1fr);align-items:center;gap:14px;margin-top:11px}.field label{margin:0;color:#f1eee7;font-weight:650;font-size:15px}input,button{width:100%;min-height:50px;padding:13px 14px;border-radius:9px;border:1px solid #8f6b29;font-size:16px}input{background:#34322d;color:#fff;outline:none}input::placeholder{color:#a8a39a}input:focus{border-color:#f2c85c;box-shadow:0 0 0 3px #f2c85c2e}button{margin-top:20px;background:linear-gradient(90deg,#ffe38a 0%,#f0c65f 48%,#b77a25 100%);color:#211b0d;font-weight:750;cursor:pointer;box-shadow:0 6px 18px #c48d3a4d}button:hover{background:linear-gradient(90deg,#fff0b0 0%,#ffda76 48%,#d69a35 100%)}.actions{display:flex;gap:10px;margin-top:20px}.actions a{flex:1;text-decoration:none}.actions button{margin-top:0;padding-left:8px;padding-right:8px}@media(max-width:420px){body{padding:12px 10px}main{padding:20px 17px;border-radius:13px}.brand{margin-bottom:14px}.brand img{height:78px}.intro{padding-top:15px}form{margin-top:16px}.field{grid-template-columns:1fr;gap:6px;margin-top:12px}.field label{font-size:14px}.actions{flex-direction:column}}</style><body class="${body.includes('error-page') || body.includes('submitted-page') ? 'centered-page' : ''}"><main><div class="brand"><img src="${escapeHtml(logoUrl)}" alt="Macanudo Socials"></div>${body}</main></body>`

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
  return `<div class="error-page" style="max-width:480px;margin:0 auto;text-align:center"><h1>${title}</h1><div class="actions" style="justify-content:center"><a href="whatsapp://send?text=${encodedCommand}"><button type="button">Return to WhatsApp</button></a><a href="https://wa.me/?text=${encodedCommand}"><button type="button">Register again</button></a></div></div>`
}

export const eventHandler: EventHandler = async event => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, 'Method not allowed')
  let referralCode = ''
  let logoUrl = DEFAULT_APP_LOGO_URL
  try {
    const requestUrl = event.rawUrl ? new URL(event.rawUrl) : null
    const rawToken = event.queryStringParameters?.token || ''
    const token = rawToken || requestUrl?.searchParams.get('token') || ''
    referralCode = normalizeReferralCode(event.queryStringParameters?.ref || requestUrl?.searchParams.get('ref') || null)
    if (!/^[a-f0-9]{64}$/.test(token)) return response(400, page('Registration link invalid', recoveryBody(referralCode), DEFAULT_APP_LOGO_URL))
    const db = init()
    try { logoUrl = await loadAppLogo(db) } catch { /* Keep the configured public fallback logo. */ }
    const session = await loadSession(db, token)
    if (!session) return response(410, page('Registration link expired', recoveryBody(referralCode, 'Registration link expired'), logoUrl))
    if (event.httpMethod === 'GET') return response(200, page('Register for Macanudo Socials', '<div class="intro"><h1>Register for Macanudo Socials</h1><p>Enter your name, email, and login password.</p></div><form method="post"><div class="field"><label for="name">Name</label><input id="name" name="name" placeholder="Enter your name" required minlength="2" maxlength="128" autocomplete="name"></div><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" placeholder="you@example.com" required maxlength="254" autocomplete="email"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" placeholder="At least 6 characters" required minlength="6" maxlength="128" autocomplete="new-password"></div><div class="field"><label for="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" placeholder="Re-enter your password" required minlength="6" maxlength="128" autocomplete="new-password"></div><button type="submit">Submit registration</button></form>', logoUrl))
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
    const settings = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data()
    const businessWhatsAppId = typeof settings?.whapiUserId === 'string' && /^\d{8,15}$/.test(settings.whapiUserId)
      ? settings.whapiUserId : DEFAULT_WHAPI_USER_ID
    const appUrl = `whatsapp://send?phone=${businessWhatsAppId}`
    const webUrl = `https://wa.me/${businessWhatsAppId}`
    const returnPage = `<div class="submitted-page" style="text-align:center"><h1>Details submitted</h1><p>Your registration details were sent to WhatsApp. Click <strong>Confirm</strong> to finish registration.</p><p>Email: ${escapeHtml(maskEmail(email))}</p><a id="return-whatsapp" href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer"><button type="button">Return to WhatsApp</button></a></div><script>setTimeout(function(){window.open(${JSON.stringify(appUrl)},'_blank','noopener,noreferrer')},150)</script>`
    return response(200, page('Details submitted', returnPage, logoUrl))
  } catch {
    return response(503, page('Registration unavailable', recoveryBody(referralCode, 'Registration unavailable'), logoUrl))
  }
}

export default toWebFunction(eventHandler)
