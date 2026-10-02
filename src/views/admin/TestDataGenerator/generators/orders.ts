// 订单生成器
import { doc, setDoc, updateDoc, Timestamp, getDocs, query, limit, where, collection } from 'firebase/firestore'
import { db } from '../../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../../config/globalCollections'
import type { Order, Event, VisitSession, Cigar } from '../../../../types'
import { removeUndefined } from './utils'

/**
 * 生成订单编号
 */
function generateOrderNo(type: 'event' | 'redemption', createdAt: Date, index: number): string {
  const year = createdAt.getFullYear()
  const month = String(createdAt.getMonth() + 1).padStart(2, '0')
  const seq = String(index + 1).padStart(4, '0')
  const suffix = type === 'event' ? 'E' : 'R'
  return `ORD-${year}-${month}-${seq}-${suffix}`
}

/**
 * 生成活动订单
 */
async function generateEventOrders(
  count: number,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // 获取所有活动
    const eventsQuery = query(collection(db, GLOBAL_COLLECTIONS.EVENTS), limit(2000))
    const eventsSnapshot = await getDocs(eventsQuery)
    const events = eventsSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        schedule: {
          ...data.schedule,
          startDate: data.schedule?.startDate?.toDate?.() || new Date(data.schedule?.startDate),
          endDate: data.schedule?.endDate?.toDate?.() || new Date(data.schedule?.endDate),
          registrationDeadline: data.schedule?.registrationDeadline?.toDate?.() || new Date(data.schedule?.registrationDeadline)
        }
      } as Event
    })

    if (events.length === 0) {
      return { success: false, error: '请先生成活动数据' }
    }

    // 获取所有雪茄产品
    const cigarsQuery = query(collection(db, GLOBAL_COLLECTIONS.CIGARS), limit(3000))
    const cigarsSnapshot = await getDocs(cigarsQuery)
    const cigars = cigarsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Cigar))

    const cigarMap = new Map(cigars.map(c => [c.id, c]))

    let generated = 0
    const batchSize = 100

    // 为每个活动的每个参与者生成订单
    for (const event of events) {
      const registeredUsers = event.participants?.registered || []
      const eventCigars = [...(event.cigars?.featured || []), ...(event.cigars?.tasting || [])]

      for (const userId of registeredUsers) {
        if (generated >= count) break

        const createdAt = event.schedule.startDate
        const orderNo = generateOrderNo('event', createdAt, generated)

        // 生成订单项（活动中的雪茄）
        const orderItems: Order['items'] = []
        for (const cigarId of eventCigars.slice(0, 1 + Math.floor(Math.random() * 3))) { // 1-4个雪茄
          const cigar = cigarMap.get(cigarId)
          if (!cigar) continue

          orderItems.push({
            cigarId,
            name: cigar.name,
            quantity: 1 + Math.floor(Math.random() * 3), // 1-3支
            price: cigar.price
          })
        }

        if (orderItems.length === 0) continue

        const total = orderItems.reduce((sum, item) => sum + item.quantity * item.price, 0)

        // 订单状态分布：5% pending, 10% confirmed, 15% shipped, 20% delivered, 45% completed, 5% cancelled
        const statusRand = Math.random()
        const status = statusRand < 0.05 ? 'pending' :
                       statusRand < 0.15 ? 'confirmed' :
                       statusRand < 0.3 ? 'shipped' :
                       statusRand < 0.5 ? 'delivered' :
                       statusRand < 0.95 ? 'completed' : 'cancelled'

        const orderData = {
          id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          orderNo,
          userId,
          items: orderItems,
          total,
          status,
          source: {
            type: 'event',
            eventId: event.id,
            note: '活动订单'
          },
          payment: {
            method: status !== 'pending' ? (['credit', 'paypal', 'bank_transfer'][Math.floor(Math.random() * 3)] as 'credit' | 'paypal' | 'bank_transfer') : 'bank_transfer',
            transactionId: status !== 'pending' ? `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` : undefined,
            paidAt: status !== 'pending' ? new Date(createdAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) : undefined
          },
          shipping: {
            address: '随机地址',
            trackingNumber: status >= 'shipped' ? `TRACK-${Date.now()}` : undefined
          },
          createdAt,
          updatedAt: status === 'completed' ? new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000) : createdAt
        }

        const data = removeUndefined({
          ...orderData,
          items: orderData.items.map(item => ({
            ...item
          })),
          payment: {
            ...orderData.payment,
            paidAt: orderData.payment.paidAt ? Timestamp.fromDate(orderData.payment.paidAt) : undefined
          },
          createdAt: Timestamp.fromDate(orderData.createdAt),
          updatedAt: Timestamp.fromDate(orderData.updatedAt)
        })
        await setDoc(doc(db, GLOBAL_COLLECTIONS.ORDERS, orderNo), data)

        generated++

        if (generated % batchSize === 0) {
          const progress = Math.round((generated / count) * 100)
          onProgress?.(progress)
        }
      }
    }

    const progress = 100
    onProgress?.(progress)

    return { success: true, count: generated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成活动订单失败' }
  }
}

/**
 * 生成兑换订单
 */
async function generateRedemptionOrders(
  count: number,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // 获取所有有兑换的驻店记录
    const sessionsQuery = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('status', '==', 'completed'),
      limit(200000)
    )
    const sessionsSnapshot = await getDocs(sessionsQuery)
    const sessions = sessionsSnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        checkInAt: data.checkInAt?.toDate?.() || new Date(data.checkInAt),
        checkOutAt: data.checkOutAt?.toDate?.() || new Date(data.checkOutAt),
        redemptions: data.redemptions?.map((r: any) => ({
          ...r,
          redeemedAt: r.redeemedAt?.toDate?.() || new Date(r.redeemedAt)
        }))
      } as VisitSession
    }).filter(s => s.redemptions && s.redemptions.length > 0)

    if (sessions.length === 0) {
      return { success: false, error: '请先生成驻店记录数据（包含兑换项）' }
    }

    // 获取所有雪茄产品
    const cigarsQuery = query(collection(db, GLOBAL_COLLECTIONS.CIGARS), limit(3000))
    const cigarsSnapshot = await getDocs(cigarsQuery)
    const cigars = cigarsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Cigar))

    const cigarMap = new Map(cigars.map(c => [c.id, c.name]))

    let generated = 0
    const batchSize = 100

    for (let i = 0; i < Math.min(sessions.length, count); i++) {
      const session = sessions[i]
      if (!session.redemptions || session.redemptions.length === 0) continue

      const createdAt = session.checkOutAt || session.checkInAt
      const orderNo = generateOrderNo('redemption', createdAt, generated)

      // 生成订单项（兑换的雪茄）
      const orderItems: Order['items'] = session.redemptions.map(redemption => ({
        cigarId: redemption.cigarId,
        name: cigarMap.get(redemption.cigarId) || 'Unknown',
        quantity: redemption.quantity,
        price: 0 // 兑换订单价格为0
      }))

      const orderData: Order = {
        id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        orderNo,
        userId: session.userId,
        items: orderItems,
        total: 0,
        status: 'completed',
        source: {
          type: 'direct',
          note: '驻店兑换'
        },
        payment: {
          method: 'bank_transfer' as const,
          paidAt: createdAt
        },
        shipping: {
          address: '会所自提',
          trackingNumber: undefined
        },
        createdAt,
        updatedAt: createdAt
      }

      const data = removeUndefined({
        ...orderData,
        payment: {
          ...orderData.payment,
          paidAt: Timestamp.fromDate(orderData.payment.paidAt!)
        },
        createdAt: Timestamp.fromDate(orderData.createdAt),
        updatedAt: Timestamp.fromDate(orderData.updatedAt)
      })
      await setDoc(doc(db, GLOBAL_COLLECTIONS.ORDERS, orderNo), data)

      // 更新驻店记录的 orderId
      await updateDoc(doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, session.id), {
        orderId: orderNo
      })

      generated++

      if (generated % batchSize === 0) {
        const progress = Math.round((generated / Math.min(sessions.length, count)) * 100)
        onProgress?.(progress)
      }
    }

    const progress = 100
    onProgress?.(progress)

    return { success: true, count: generated }
  } catch (error: any) {
    return { success: false, error: error.message || '生成兑换订单失败' }
  }
}

/**
 * 批量生成订单
 */
export async function generateOrders(
  type: 'event' | 'redemption',
  count: number,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; count?: number; error?: string }> {
  if (type === 'event') {
    return generateEventOrders(count, onProgress)
  } else {
    return generateRedemptionOrders(count, onProgress)
  }
}

