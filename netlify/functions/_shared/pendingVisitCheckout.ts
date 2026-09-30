import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS } from '../../../src/config/globalCollections'

export type PendingCheckoutResult =
  | { status: 'none' | 'insufficient' | 'completed'; sessionId?: string; shortfall?: number }

const numberValue = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const settleRedemptions = async (db: Firestore, sessionId: string, session: any) => {
  const redemptionDoc = await db.collection(GLOBAL_COLLECTIONS.REDEMPTION_RECORDS).doc(sessionId).get()
  const records = redemptionDoc.exists ? (redemptionDoc.data()?.redemptions || []) : []
  if (records.length === 0 || records.some((record: any) => record.status !== 'completed')) return

  const totals = new Map<string, { cigarName: string; quantity: number }>()
  for (const record of records) {
    const cigarId = String(record.cigarId || '').trim()
    const quantity = numberValue(record.quantity)
    if (!cigarId || quantity <= 0) continue
    const existing = totals.get(cigarId)
    totals.set(cigarId, {
      cigarName: record.cigarName || existing?.cigarName || '',
      quantity: (existing?.quantity || 0) + quantity
    })
  }
  if (totals.size === 0) return

  const orderId = `REDEMPTION-${sessionId}`
  const outboundId = `REDEMPTION-${sessionId}`
  const batch = db.batch()
  const orderItems: any[] = []
  const outboundItems: any[] = []

  for (const [cigarId, item] of totals) {
    const cigarDoc = await db.collection(GLOBAL_COLLECTIONS.CIGARS).doc(cigarId).get()
    if (!cigarDoc.exists) continue
    const cigar = cigarDoc.data() || {}
    const unitPrice = numberValue(cigar.price)
    orderItems.push({ cigarId, quantity: item.quantity, price: 0 })
    outboundItems.push({
      cigarId,
      cigarName: cigar.name || item.cigarName,
      itemType: 'cigar',
      quantity: item.quantity,
      unitPrice,
      subtotal: unitPrice * item.quantity
    })
  }
  if (orderItems.length === 0) return

  const now = Timestamp.now()
  batch.set(db.collection(GLOBAL_COLLECTIONS.ORDERS).doc(orderId), {
    userId: session.userId,
    items: orderItems,
    total: 0,
    status: 'completed',
    source: { type: 'direct', note: `驻店兑换订单 (Session: ${sessionId})` },
    payment: { method: 'bank_transfer', paidAt: now },
    shipping: { address: '店内兑换' },
    createdAt: now,
    updatedAt: now
  }, { merge: true })

  batch.set(db.collection(GLOBAL_COLLECTIONS.OUTBOUND_ORDERS).doc(outboundId), {
    referenceNo: orderId,
    type: 'sale',
    reason: `驻店兑换出库 (Session: ${sessionId})`,
    items: outboundItems,
    totalQuantity: outboundItems.reduce((sum, item) => sum + item.quantity, 0),
    totalValue: outboundItems.reduce((sum, item) => sum + item.subtotal, 0),
    orderId,
    userId: session.userId,
    userName: session.userName || '',
    storeId: session.storeId || null,
    status: 'completed',
    operatorId: session.checkoutPending?.requestedBy || 'system_reload_checkout',
    createdAt: now,
    updatedAt: now
  }, { merge: true })

  for (const item of outboundItems) {
    batch.set(db.collection(GLOBAL_COLLECTIONS.INVENTORY_MOVEMENTS).doc(`${outboundId}-${item.cigarId}`), {
      cigarId: item.cigarId,
      cigarName: item.cigarName,
      itemType: 'cigar',
      type: 'out',
      quantity: item.quantity,
      referenceNo: orderId,
      orderType: 'outbound',
      outboundOrderId: outboundId,
      reason: `驻店兑换出库 (Session: ${sessionId})`,
      unitPrice: item.unitPrice,
      storeId: session.storeId || null,
      createdAt: now
    }, { merge: true })
  }

  batch.update(db.collection(GLOBAL_COLLECTIONS.VISIT_SESSIONS).doc(sessionId), {
    orderId,
    outboundOrderId: outboundId,
    updatedAt: now
  })
  await batch.commit()
}

export const settlePendingVisitCheckout = async (
  db: Firestore,
  userId: string
): Promise<PendingCheckoutResult> => {
  const userRef = db.collection(GLOBAL_COLLECTIONS.USERS).doc(userId)
  const initialUser = await userRef.get()
  const sessionId = initialUser.data()?.membership?.currentVisitSessionId as string | undefined
  if (!sessionId) return { status: 'none' }

  const sessionRef = db.collection(GLOBAL_COLLECTIONS.VISIT_SESSIONS).doc(sessionId)
  const pointsConfigRef = db.collection('config').doc('points')
  let completedSession: any = null

  const result = await db.runTransaction(async transaction => {
    const [userDoc, sessionDoc, pointsConfigDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(sessionRef),
      transaction.get(pointsConfigRef)
    ])
    if (!userDoc.exists || !sessionDoc.exists) return { status: 'none' as const }

    const user = userDoc.data() || {}
    const session = sessionDoc.data() || {}
    const pending = session.checkoutPending
    if (session.status !== 'pending' || !pending || !['awaiting_reload', 'failed'].includes(pending.status)) {
      return { status: 'none' as const }
    }

    const currentPoints = numberValue(user.membership?.points)
    const pointsDueNow = numberValue(pending.pointsDueNow)
    const pointsAfterCharge = currentPoints - pointsDueNow
    if (pointsAfterCharge < 0) {
      const shortfall = Math.abs(pointsAfterCharge)
      transaction.update(sessionRef, {
        'checkoutPending.status': 'awaiting_reload',
        'checkoutPending.shortfall': shortfall,
        updatedAt: FieldValue.serverTimestamp()
      })
      return { status: 'insufficient' as const, sessionId, shortfall }
    }

    const isRealtime = Boolean(session.realtimeDeductionsEnabled && !session.dayPass?.isPurchased)
    const existingRealtimePoints = numberValue(session.realtimePointsDeducted)
    const dayPassCost = session.dayPass?.isPurchased ? numberValue(session.dayPass?.config?.cost) : 0
    const totalPointsDeducted = isRealtime
      ? Math.max(0, existingRealtimePoints + pointsDueNow)
      : Math.max(0, pointsDueNow + dayPassCost)
    const rebatePercent = numberValue(pointsConfigDoc.data()?.purchase?.rebatePercent)
    const rebatePoints = Math.round(totalPointsDeducted * Math.max(0, rebatePercent) / 100)
    const finalPoints = pointsAfterCharge + rebatePoints
    const requestedAt = pending.requestedAt || Timestamp.now()
    const operatorId = pending.requestedBy || 'system_reload_checkout'

    const userUpdate: Record<string, unknown> = {
      'membership.points': finalPoints,
      'membership.currentVisitSessionId': null,
      updatedAt: FieldValue.serverTimestamp()
    }
    if (!session.dayPass?.isPurchased && !isRealtime) {
      userUpdate['membership.totalVisitHours'] = numberValue(user.membership?.totalVisitHours) + numberValue(pending.durationHours)
    } else if (isRealtime && pending.realtimeHoursAdjustment !== undefined) {
      userUpdate['membership.totalVisitHours'] = Math.max(
        0,
        numberValue(user.membership?.totalVisitHours) + numberValue(pending.realtimeHoursAdjustment)
      )
    }
    transaction.update(userRef, userUpdate)

    if (totalPointsDeducted > 0) {
      transaction.set(db.collection(GLOBAL_COLLECTIONS.POINTS_RECORDS).doc(`visit-${sessionId}-charge`), {
        userId,
        userName: session.userName || user.displayName || '',
        type: 'spend',
        amount: isRealtime ? totalPointsDeducted : Math.max(0, pointsDueNow),
        source: 'visit',
        description: isRealtime
          ? `驻店计时扣费 (${numberValue(pending.durationHours)}小时，共${totalPointsDeducted}积分)`
          : `驻店结算扣费 (${numberValue(pending.durationHours)}小时，共${Math.max(0, pointsDueNow)}积分)`,
        relatedId: sessionId,
        isVisitSessionSummary: isRealtime,
        balance: pointsAfterCharge,
        createdBy: operatorId,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true })
    }

    if (rebatePoints > 0) {
      transaction.set(db.collection(GLOBAL_COLLECTIONS.POINTS_RECORDS).doc(`visit-${sessionId}-rebate`), {
        userId,
        userName: session.userName || user.displayName || '',
        type: 'earn',
        amount: rebatePoints,
        source: 'visit',
        description: `驻店消费返点 ${rebatePercent}% (${rebatePoints}积分)`,
        relatedId: sessionId,
        balance: finalPoints,
        createdBy: operatorId,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true })
    }

    const sessionUpdate: Record<string, unknown> = {
      checkOutAt: requestedAt,
      checkOutBy: operatorId,
      durationMinutes: numberValue(pending.durationMinutes),
      durationHours: numberValue(pending.durationHours),
      calculatedAt: FieldValue.serverTimestamp(),
      pointsDeducted: totalPointsDeducted,
      pointsRecordId: totalPointsDeducted > 0 ? `visit-${sessionId}-charge` : null,
      rebatePoints,
      rebatePointsRecordId: rebatePoints > 0 ? `visit-${sessionId}-rebate` : null,
      checkoutPending: null,
      status: 'completed',
      updatedAt: FieldValue.serverTimestamp()
    }
    if (isRealtime) {
      sessionUpdate.realtimePointsDeducted = totalPointsDeducted
      if (pending.realtimeDeductionCountTarget !== undefined) {
        sessionUpdate.deductionCount = numberValue(pending.realtimeDeductionCountTarget)
      }
    }
    transaction.update(sessionRef, sessionUpdate)

    completedSession = { ...session, checkoutPending: pending, userId }
    return { status: 'completed' as const, sessionId }
  })

  if (result.status === 'completed' && completedSession) {
    await settleRedemptions(db, sessionId, completedSession)
  }
  return result
}
