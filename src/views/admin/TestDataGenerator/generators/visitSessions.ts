// 驻店记录生成器
import { collection, addDoc, Timestamp, getDocs, query, limit } from 'firebase/firestore'
import { db } from '../../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../../config/globalCollections'
import type { VisitSession, User, Cigar } from '../../../../types'
import { removeUndefined } from './utils'

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
 * 按完整分钟计算驻店时长并转换为小时。
 */
function calculateVisitDuration(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0

  const completedMinutes = Math.floor(minutes)
  return completedMinutes / 60
}

/**
 * 生成驻店记录数据
 */
function generateVisitSessionData(
  user: User,
  cigars: Cigar[],
  dailyRedemptions: Map<string, number> // key: userId-dayKey, value: 当日已兑换数量
): Omit<VisitSession, 'id'> {
  const checkInAt = randomDateInLast18Months()
  const dayKey = checkInAt.toISOString().split('T')[0] // YYYY-MM-DD
  const redemptionKey = `${user.id}-${dayKey}`
  const currentDailyCount = dailyRedemptions.get(redemptionKey) || 0
  
  // 状态：80% completed, 20% pending
  const status = Math.random() > 0.2 ? 'completed' : 'pending'
  
  // 驻店时长：15分钟-8小时
  const durationMinutes = status === 'completed'
    ? 15 + Math.floor(Math.random() * (8 * 60 - 15)) // 15分钟-8小时
    : undefined
  const durationHours = durationMinutes !== undefined 
    ? calculateVisitDuration(durationMinutes)
    : undefined
  
  const checkOutAt = status === 'completed' && durationMinutes !== undefined
    ? new Date(checkInAt.getTime() + durationMinutes * 60 * 1000)
    : undefined
  
  // 生成兑换项（0-3个，确保不超过每日限制）
  const maxRedemptions = Math.min(3 - currentDailyCount, 3)
  const redemptionCount = maxRedemptions > 0 ? Math.floor(Math.random() * (maxRedemptions + 1)) : 0
  const redemptions: Array<{
    recordId?: string;
    cigarId: string;
    cigarName: string;
    quantity: number;
    redeemedAt: Date;
    redeemedBy: string;
  }> = redemptionCount > 0 ? [] : undefined as any

  if (redemptions && redemptionCount > 0 && cigars.length > 0) {
    const shuffledCigars = [...cigars].sort(() => Math.random() - 0.5)
    for (let i = 0; i < redemptionCount; i++) {
      const cigar = shuffledCigars[i % shuffledCigars.length]
      const redeemedAt = new Date(
        checkInAt.getTime() + 
        Math.random() * (checkOutAt ? (checkOutAt.getTime() - checkInAt.getTime()) : 60 * 60 * 1000)
      )
      
      redemptions.push({
        cigarId: cigar.id,
        cigarName: cigar.name,
        quantity: 1, // 每次兑换1支
        redeemedAt,
        redeemedBy: 'system' // 系统生成
      } as any)
      
      // 更新每日兑换计数
      dailyRedemptions.set(redemptionKey, currentDailyCount + i + 1)
    }
  }

  // 计算扣除的积分（假设每小时25积分）
  const hourlyRate = 25
  const pointsDeducted = durationHours !== undefined 
    ? Math.round(durationHours * hourlyRate)
    : undefined

  return {
    userId: user.id,
    userName: user.displayName,
    storeId: 'test-store-id',
    status,
    checkInAt,
    checkInBy: 'system',
    checkOutAt,
    checkOutBy: status === 'completed' ? 'system' : undefined,
    durationMinutes,
    durationHours,
    calculatedAt: status === 'completed' ? checkOutAt : undefined,
    redemptions,
    pointsDeducted,
    createdAt: checkInAt,
    updatedAt: checkOutAt || checkInAt
  }
}

/**
 * 批量生成驻店记录
 */
export async function generateVisitSessions(
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

    // 获取所有雪茄产品
    const cigarsQuery = query(collection(db, GLOBAL_COLLECTIONS.CIGARS), limit(3000))
    const cigarsSnapshot = await getDocs(cigarsQuery)
    const cigars = cigarsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Cigar))

    if (cigars.length === 0) {
      return { success: false, error: '请先生成雪茄产品数据' }
    }

    // 用户活跃度分布：20%高度活跃（50-100条），60%中等活跃（10-30条），20%低活跃（1-5条）
    const activeUsers: User[] = []
    const mediumUsers: User[] = []
    const lowUsers: User[] = []
    
    const shuffledUsers = [...users].sort(() => Math.random() - 0.5)
    const highCount = Math.floor(users.length * 0.2)
    const mediumCount = Math.floor(users.length * 0.6)
    
    activeUsers.push(...shuffledUsers.slice(0, highCount))
    mediumUsers.push(...shuffledUsers.slice(highCount, highCount + mediumCount))
    lowUsers.push(...shuffledUsers.slice(highCount + mediumCount))

    // 分配记录数量
    const highRecords = Math.floor(count * 0.2) // 20% 给高度活跃用户
    const mediumRecords = Math.floor(count * 0.6) // 60% 给中等活跃用户
    const lowRecords = count - highRecords - mediumRecords // 剩余给低活跃用户

    const sessionUsers: Array<{ user: User; count: number }> = []
    
    // 高度活跃用户：每人50-100条
    for (const user of activeUsers) {
      const userCount = 50 + Math.floor(Math.random() * 50)
      sessionUsers.push({ user, count: userCount })
    }
    
    // 中等活跃用户：每人10-30条
    for (const user of mediumUsers) {
      const userCount = 10 + Math.floor(Math.random() * 20)
      sessionUsers.push({ user, count: userCount })
    }
    
    // 低活跃用户：每人1-5条
    for (const user of lowUsers) {
      const userCount = 1 + Math.floor(Math.random() * 5)
      sessionUsers.push({ user, count: userCount })
    }

    // 打乱顺序
    sessionUsers.sort(() => Math.random() - 0.5)

    const batchSize = 500
    let generated = 0
    const dailyRedemptions = new Map<string, number>() // 跟踪每日兑换数量

    for (const { user, count: userCount } of sessionUsers) {
      for (let i = 0; i < userCount && generated < count; i++) {
        const sessionData = generateVisitSessionData(user, cigars, dailyRedemptions)
        
        const data = removeUndefined({
          ...sessionData,
          checkInAt: Timestamp.fromDate(sessionData.checkInAt),
          checkOutAt: sessionData.checkOutAt ? Timestamp.fromDate(sessionData.checkOutAt) : undefined,
          calculatedAt: sessionData.calculatedAt ? Timestamp.fromDate(sessionData.calculatedAt) : undefined,
          redemptions: sessionData.redemptions?.map(r => ({
            ...r,
            redeemedAt: Timestamp.fromDate(r.redeemedAt)
          })),
          createdAt: Timestamp.fromDate(sessionData.createdAt),
          updatedAt: Timestamp.fromDate(sessionData.updatedAt)
        })
        await addDoc(collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS), data)

        generated++
        
        if (generated % batchSize === 0) {
          const progress = Math.round((generated / count) * 100)
          onProgress?.(progress)
        }
      }
    }

    const progress = Math.round((generated / count) * 100)
    onProgress?.(progress)

    return { success: true, count: generated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成驻店记录失败' }
  }
}

