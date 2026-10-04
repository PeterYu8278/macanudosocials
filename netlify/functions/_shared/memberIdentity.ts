import type { Auth, UserRecord } from 'firebase-admin/auth'
import type { DocumentData, Firestore } from 'firebase-admin/firestore'

export class MemberIdentityError extends Error {
  constructor(public code: string, public status: number) { super(code) }
}

export const memberRoleRank: Record<string, number> = { developer: 5, superAdmin: 4, admin: 3, storeAdmin: 2 }

export async function resolveMemberAccount(auth: Auth, userId: string, member: DocumentData): Promise<UserRecord> {
  // Only server-written mappings survive email changes. Never accept a UID from the request.
  const uid = member.authUid || userId
  try { return await auth.getUser(uid) } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
    if (member.authUid || !member.email) throw new MemberIdentityError('auth-account-missing', 409)
    try { return await auth.getUserByEmail(member.email.trim().toLowerCase()) } catch (lookupError) {
      if ((lookupError as { code?: string }).code === 'auth/user-not-found') throw new MemberIdentityError('auth-account-missing', 409)
      throw lookupError
    }
  }
}

export async function authorizeMemberChange(db: Firestore, operatorUid: string, userId: string, member: DocumentData, accountUid: string, adminOnly = false) {
  if (operatorUid === accountUid && !adminOnly) return
  const operator = (await db.collection('users').doc(operatorUid).get()).data()
  const operatorRank = memberRoleRank[operator?.role] || 0
  const linkedMember = accountUid === userId ? member : (await db.collection('users').doc(accountUid).get()).data()
  const targetRank = Math.max(memberRoleRank[member.role] || 0, memberRoleRank[linkedMember?.role] || 0)
  if (operatorRank < 3 || (operatorUid !== accountUid && targetRank >= operatorRank)) {
    throw new MemberIdentityError('forbidden', 403)
  }
}
