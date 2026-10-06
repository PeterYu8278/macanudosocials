import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { loadWhatsApp, submitWhapi, submitWhapiButtons } from './_shared/whatsapp'
import { maskEmail, registrationTokenHash, validateRegistrationEmail, type WhatsAppRegistrationSession } from './_shared/whatsappRegistration'
import { toWebFunction, type EventHandler } from './_shared/webFunction'

const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const page = (title: string, body: string) => `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;background:#1d1b17;color:#fff0bd;margin:0;padding:24px}main{max-width:460px;margin:8vh auto;background:#29251d;border:1px solid #b88b31;border-radius:12px;padding:24px}label{display:block;margin:16px 0 6px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:8px;border:1px solid #a67b2d;font-size:16px}input{background:#35322d;color:#fff}button{margin-top:22px;background:#f0c65f;color:#211b0d;font-weight:700}p{line-height:1.6}</style><main>${body}</main>`

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

export const eventHandler: EventHandler = async event => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, 'Method not allowed')
  try {
    const token = event.queryStringParameters?.token || ''
    if (!/^[a-f0-9]{64}$/.test(token)) return response(400, page('链接无效', '<h1>注册链接无效</h1><p>请重新发送 /register。</p>'))
    const db = init()
    const session = await loadSession(db, token)
    if (!session) return response(410, page('链接已失效', '<h1>注册链接已失效</h1><p>请重新发送 /register 获取新链接。</p>'))
    if (event.httpMethod === 'GET') return response(200, page('注册 Macanudo Socials', '<h1>注册 Macanudo Socials</h1><p>请填写姓名和 Email。</p><form method="post"><label for="name">Name</label><input id="name" name="name" required minlength="2" maxlength="128"><label for="email">Email</label><input id="email" name="email" type="email" required maxlength="254"><button type="submit">提交注册资料</button></form>'))
    const form = new URLSearchParams(event.body || '')
    const name = (form.get('name') || '').trim()
    const email = validateRegistrationEmail(form.get('email') || '')
    if (name.length < 2 || name.length > 128 || !email) return response(400, page('资料不正确', '<h1>资料不正确</h1><p>请返回重新填写姓名和 Email。</p>'))
    await session.ref.set({ ...session.data, displayName: name, email, step: 'awaiting-final-confirm', updatedAt: Timestamp.now() })
    const whatsapp = await loadWhatsApp(db)
    const confirmation = `欢迎注册 Macanudo Socials。请确认注册资料：\n姓名：${name}\n电话：${session.data.phone}\nEmail：${email}`
    const result = await submitWhapiButtons(whatsapp.token, session.data.phone, confirmation)
    if (result.status !== 'accepted') await submitWhapi(whatsapp.token, session.data.phone, `${confirmation}\n\n请回复 CONFIRM 确认，或 CANCEL 取消。`)
    return response(200, page('资料已提交', `<h1>资料已提交</h1><p>请回到 WhatsApp 点击 Confirm 确认。</p><p>已提交 Email：${escapeHtml(maskEmail(email))}</p>`))
  } catch {
    return response(503, page('暂时无法注册', '<h1>暂时无法处理</h1><p>请稍后重新发送 /register。</p>'))
  }
}

export default toWebFunction(eventHandler)
