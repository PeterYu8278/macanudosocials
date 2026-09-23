// 活动生成器
import { collection, addDoc, Timestamp, getDocs, query, limit } from 'firebase/firestore'
import { db } from '../../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../../config/globalCollections'
import type { Event, User, Cigar } from '../../../../types'

const EVENT_TITLES = [
  'Premium Cigar Tasting', 'Cigar Appreciation Night', 'VIP Cigar Lounge',
  'Cigar Masterclass', 'Cuban Cigar Experience', 'Evening Cigar Social',
  'Cigar Pairing Event', 'Luxury Cigar Showcase', 'Cigar Connoisseur Gathering',
  'Exclusive Cigar Event', 'MS Meeting', 'Premium Tobacco Tasting'
]

const LOCATIONS = [
  'Main Lounge', 'VIP Room', 'Private Terrace', 'Executive Suite',
  'Cigar Bar', 'Outdoor Patio', 'Private Dining Room', 'Members Club'
]

const ADDRESSES = [
  '123 Premium Street, Kuala Lumpur', '456 Luxury Avenue, Petaling Jaya',
  '789 Exclusive Road, Mont Kiara', '321 Elite Boulevard, Bangsar'
]

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
 * 生成活动数据
 */
function generateEventData(
  index: number,
  users: User[],
  cigars: Cigar[]
): Omit<Event, 'id'> {
  const title = `${EVENT_TITLES[index % EVENT_TITLES.length]} ${index > EVENT_TITLES.length ? Math.floor(index / EVENT_TITLES.length) + 1 : ''}`.trim()
  
  // 随机选择15个用户参与
  const registeredUsers: string[] = []
  const shuffledUsers = [...users].sort(() => Math.random() - 0.5)
  for (let i = 0; i < Math.min(15, shuffledUsers.length); i++) {
    registeredUsers.push(shuffledUsers[i].id)
  }

  // 随机选择组织者（管理员）
  const adminUsers = users.filter(u => u.role === 'superAdmin' || u.role === 'developer')
  const organizerId = adminUsers.length > 0 
    ? adminUsers[Math.floor(Math.random() * adminUsers.length)].id
    : users[0].id

  // 随机选择3-8个雪茄（featured + tasting）
  const shuffledCigars = [...cigars].sort(() => Math.random() - 0.5)
  const featuredCount = 3 + Math.floor(Math.random() * 3) // 3-5个
  const tastingCount = 2 + Math.floor(Math.random() * 2) // 2-3个
  const featured = shuffledCigars.slice(0, featuredCount).map(c => c.id)
  const tasting = shuffledCigars.slice(featuredCount, featuredCount + tastingCount).map(c => c.id)

  // 活动状态分布：10% draft, 20% published, 10% ongoing, 50% completed, 10% cancelled
  const statusRand = Math.random()
  const status = statusRand < 0.1 ? 'draft' :
                  statusRand < 0.3 ? 'published' :
                  statusRand < 0.4 ? 'ongoing' :
                  statusRand < 0.9 ? 'completed' : 'cancelled'

  // 时间生成
  const startDate = randomDateInLast18Months()
  const durationDays = 1 + Math.floor(Math.random() * 7) // 1-7天
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000)
  const registrationDeadline = new Date(startDate.getTime() - (1 + Math.floor(Math.random() * 7)) * 24 * 60 * 60 * 1000)

  const locationIndex = Math.floor(Math.random() * LOCATIONS.length)
  const addressIndex = Math.floor(Math.random() * ADDRESSES.length)

  return {
    title,
    description: `Join us for an exclusive ${title.toLowerCase()} featuring premium cigars and expert guidance.`,
    organizerId,
    location: {
      name: LOCATIONS[locationIndex],
      address: ADDRESSES[addressIndex]
    },
    schedule: {
      startDate,
      endDate,
      registrationDeadline
    },
    participants: {
      registered: registeredUsers,
      maxParticipants: 15 + Math.floor(Math.random() * 35), // 15-50
      fee: Math.random() > 0.5 ? Math.floor(Math.random() * 200) : 0 // 0-200 RM
    },
    cigars: {
      featured,
      tasting
    },
    status,
    isPrivate: Math.random() > 0.8, // 20% 私人活动
    createdAt: startDate,
    updatedAt: startDate
  }
}

/**
 * 批量生成活动
 */
export async function generateEvents(
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

    const batchSize = 100
    let generated = 0

    for (let i = 0; i < count; i += batchSize) {
      const batch = []
      const currentBatchSize = Math.min(batchSize, count - i)

      for (let j = 0; j < currentBatchSize; j++) {
        const eventData = generateEventData(i + j, users, cigars)
        batch.push({
          ...eventData,
          schedule: {
            ...eventData.schedule,
            startDate: Timestamp.fromDate(eventData.schedule.startDate),
            endDate: Timestamp.fromDate(eventData.schedule.endDate),
            registrationDeadline: Timestamp.fromDate(eventData.schedule.registrationDeadline)
          },
          createdAt: Timestamp.fromDate(eventData.createdAt),
          updatedAt: Timestamp.fromDate(eventData.updatedAt)
        })
      }

      // 批量写入
      const promises = batch.map(data => 
        addDoc(collection(db, GLOBAL_COLLECTIONS.EVENTS), data)
      )
      await Promise.all(promises)

      generated += currentBatchSize
      const progress = Math.round((generated / count) * 100)
      onProgress?.(progress)
    }

    return { success: true, count: generated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成活动失败' }
  }
}

