// 充值记录生成器
import { collection, addDoc, Timestamp, getDocs, query, limit } from 'firebase/firestore'
import { db } from '../../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../../config/globalCollections'
import type { ReloadRecord, User } from '../../../../types'
import { removeUndefined } from './utils'

const RELOAD_EXCHANGE_RATE = 1 // 1 RM = 1 积分

/**
 * 生成随机日期（过去18个月）
 */
function randomDateInLast18Months(): Date {
  const now = new Date()
  const monthsAgo = 18
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  const endDate = now
  const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())
  return new Date(randomTime)
}

/**
 * 生成充值记录数据
 */
function generateReloadRecordData(
  user: User
): Omit<ReloadRecord, 'id'> {
  const requestedAmount = 50 + Math.floor(Math.random() * 4950) // 50-5000 RM
  const pointsEquivalent = Math.round(requestedAmount * RELOAD_EXCHANGE_RATE)
  
  // 状态：90% completed, 10% pending
  const status = Math.random() > 0.1 ? 'completed' : 'pending'
  const createdAt = randomDateInLast18Months()
  const verifiedAt = status === 'completed' 
    ? new Date(createdAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) // 0-1天内
    : undefined

  return {
    userId: user.id,
    userName: user.displayName,
    requestedAmount,
    pointsEquivalent,
    pointsEquivalentBasis: 'net',
    annualFeeAmount: 0,
    status,
    verifiedAt,
    verifiedBy: status === 'completed' ? 'system' : undefined,
    verificationProof: status === 'completed' ? '自动生成' : undefined,
    adminNotes: undefined,
    createdAt,
    updatedAt: verifiedAt || createdAt
  }
}

/**
 * 批量生成充值记录
 */
export async function generateReloadRecords(
  count: number,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // 获取所有用户
    const usersQuery = query(collection(db, GLOBAL_COLLECTIONS.USERS), limit(10000))
    const usersSnapshot = await getDocs(usersQuery)
    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as User))

    if (users.length === 0) {
      return { success: false, error: '请先生成用户数据' }
    }

    // 平均每个用户2条充值记录，随机选择用户
    const shuffledUsers = [...users].sort(() => Math.random() - 0.5)
    const selectedUsers: User[] = []
    for (let i = 0; i < count; i++) {
      selectedUsers.push(shuffledUsers[i % shuffledUsers.length])
    }

    const batchSize = 500
    let generated = 0

    for (let i = 0; i < selectedUsers.length; i += batchSize) {
      const batch = []
      const currentBatchSize = Math.min(batchSize, selectedUsers.length - i)

      for (let j = 0; j < currentBatchSize; j++) {
        const user = selectedUsers[i + j]
        const recordData = generateReloadRecordData(user)
        const data = removeUndefined({
          ...recordData,
          verifiedAt: recordData.verifiedAt ? Timestamp.fromDate(recordData.verifiedAt) : undefined,
          createdAt: Timestamp.fromDate(recordData.createdAt),
          updatedAt: Timestamp.fromDate(recordData.updatedAt)
        })
        batch.push(data)
      }

      // 批量写入
      const promises = batch.map(data => 
        addDoc(collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS), data)
      )
      await Promise.all(promises)

      generated += currentBatchSize
      const progress = Math.round((generated / selectedUsers.length) * 100)
      onProgress?.(progress)
    }

    return { success: true, count: generated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成充值记录失败' }
  }
}

