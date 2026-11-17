// 积分记录生成器
import { addDoc, Timestamp, getDocs, query, limit, where, collection } from 'firebase/firestore'
import { db } from '../../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../../config/globalCollections'
import type { PointsRecord, ReloadRecord, MembershipFeeRecord, VisitSession, User } from '../../../../types'

/**
 * 批量生成积分记录
 */
export async function generatePointsRecords(
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    let totalGenerated = 0
    const batchSize = 500

    // 1. 基于充值记录生成积分记录
    const reloadRecordsQuery = query(
      collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
      where('status', '==', 'completed'),
      limit(20000)
    )
    const reloadSnapshot = await getDocs(reloadRecordsQuery)
    const reloadRecords = reloadSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        verifiedAt: data.verifiedAt?.toDate?.() || new Date(data.verifiedAt),
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as ReloadRecord
    })

    // 获取用户数据以计算余额
    const usersQuery = query(collection(db, GLOBAL_COLLECTIONS.USERS), limit(10000))
    const usersSnapshot = await getDocs(usersQuery)
    const usersMap = new Map(usersSnapshot.docs.map(doc => {
      const data = doc.data()
      return [doc.id, {
        id: doc.id,
        ...data
      } as User]
    }))

    // 按用户分组充值记录，计算余额
    const userBalances = new Map<string, number>()
    for (const record of reloadRecords) {
      const currentBalance = userBalances.get(record.userId) || 0
      userBalances.set(record.userId, currentBalance + Math.round(record.requestedAmount))
    }

    // 生成充值积分记录
    for (let i = 0; i < reloadRecords.length; i++) {
      const record = reloadRecords[i]
      const user = usersMap.get(record.userId)
      if (!user) continue

      const balance = userBalances.get(record.userId) || 0
      const pointsRecord: Omit<PointsRecord, 'id'> = {
        userId: record.userId,
        userName: record.userName,
        type: 'earn',
        amount: Math.round(record.requestedAmount),
        source: 'reload',
        description: `充值 ${record.requestedAmount} RM (${Math.round(record.requestedAmount)} 积分)`,
        relatedId: record.id,
        balance,
        createdAt: record.verifiedAt || record.createdAt,
        createdBy: record.verifiedBy
      }

      await addDoc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS), {
        ...pointsRecord,
        createdAt: Timestamp.fromDate(pointsRecord.createdAt)
      })

      totalGenerated++

      // 更新余额（减去当前记录的数量，因为后续记录应该基于之前的余额）
      userBalances.set(record.userId, balance - Math.round(record.requestedAmount))

      if (totalGenerated % batchSize === 0) {
        const progress = Math.round((totalGenerated / (reloadRecords.length * 2)) * 100)
        onProgress?.(progress)
      }
    }

    // 2. 基于会员年费记录生成积分记录（扣除）
    const feeRecordsQuery = query(
      collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
      where('status', '==', 'paid'),
      limit(10000)
    )
    const feeSnapshot = await getDocs(feeRecordsQuery)
    const feeRecords = feeSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        deductedAt: data.deductedAt?.toDate?.() || new Date(data.deductedAt),
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as MembershipFeeRecord
    })

    for (const record of feeRecords) {
      const currentBalance = userBalances.get(record.userId) || 0
      const newBalance = Math.max(0, currentBalance - record.amount)

      const pointsRecord: Omit<PointsRecord, 'id'> = {
        userId: record.userId,
        userName: record.userName,
        type: 'spend',
        amount: record.amount,
        source: 'membership_fee',
        description: `会员年费 ${record.amount} 积分`,
        relatedId: record.id,
        balance: newBalance,
        createdAt: record.deductedAt || record.createdAt,
        createdBy: 'system'
      }

      await addDoc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS), {
        ...pointsRecord,
        createdAt: Timestamp.fromDate(pointsRecord.createdAt)
      })

      userBalances.set(record.userId, newBalance)
      totalGenerated++

      if (totalGenerated % batchSize === 0) {
        const progress = Math.round((totalGenerated / (reloadRecords.length + feeRecords.length + 200000)) * 100)
        onProgress?.(progress)
      }
    }

    // 3. 基于驻店记录生成积分记录（扣除）
    const visitSessionsQuery = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('status', '==', 'completed'),
      limit(200000)
    )
    const visitSnapshot = await getDocs(visitSessionsQuery)
    const visitSessions = visitSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        checkOutAt: data.checkOutAt?.toDate?.() || new Date(data.checkOutAt),
        calculatedAt: data.calculatedAt?.toDate?.() || new Date(data.calculatedAt),
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as VisitSession
    }).filter(s => s.pointsDeducted && s.pointsDeducted > 0)

    for (const session of visitSessions) {
      if (!session.pointsDeducted) continue

      const currentBalance = userBalances.get(session.userId) || 0
      const newBalance = Math.max(0, currentBalance - session.pointsDeducted)

      const pointsRecord: Omit<PointsRecord, 'id'> = {
        userId: session.userId,
        userName: session.userName,
        type: 'spend',
        amount: session.pointsDeducted,
        source: 'visit',
        description: `驻店 ${session.durationHours || 0} 小时，扣除 ${session.pointsDeducted} 积分`,
        relatedId: session.id,
        balance: newBalance,
        createdAt: session.calculatedAt || session.checkOutAt || session.createdAt,
        createdBy: 'system'
      }

      await addDoc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS), {
        ...pointsRecord,
        createdAt: Timestamp.fromDate(pointsRecord.createdAt)
      })

      userBalances.set(session.userId, newBalance)
      totalGenerated++

      if (totalGenerated % batchSize === 0) {
        const progress = Math.round((totalGenerated / (reloadRecords.length + feeRecords.length + visitSessions.length)) * 100)
        onProgress?.(progress)
      }
    }

    const progress = 100
    onProgress?.(progress)

    return { success: true, count: totalGenerated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成积分记录失败' }
  }
}

