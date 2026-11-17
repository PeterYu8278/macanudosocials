// 带分页的 Firestore 查询函数
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  startAfter,
  where,
  Query,
  QueryDocumentSnapshot,
  getDocs,
  Timestamp
} from '@/services/firebase/monitoredFirestore'
import { db } from '../../config/firebase'
import { COLLECTIONS } from './firestore'
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections'
import type { User, Order, Transaction, VisitSession, InboundOrder, OutboundOrder } from '../../types'
import dayjs from 'dayjs'

/**
 * 获取用户列表（分页）
 */
export const getUsersPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    role?: string
    status?: string
    level?: string
    storeId?: string
  }
): Promise<{
  data: User[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, COLLECTIONS.USERS),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1) // 多取一条用于判断是否有更多数据
    )

    // 应用筛选条件
    if (filters?.role) {
      q = query(q, where('role', '==', filters.role))
    }
    if (filters?.status) {
      q = query(q, where('status', '==', filters.status))
    }
    if (filters?.level) {
      q = query(q, where('membership.level', '==', filters.level))
    }
    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }

    // 分页
    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    // 如果有多余的文档，移除最后一个
    const users = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
        membership: {
          ...data.membership,
          joinDate: data.membership?.joinDate?.toDate?.() || new Date(data.membership?.joinDate),
          lastActive: data.membership?.lastActive?.toDate?.() || new Date(data.membership?.lastActive)
        }
      } as User
    })

    return {
      data: users,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getUsersPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * 获取订单列表（分页）
 */
export const getOrdersPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    status?: string
    paymentMethod?: string
    startDate?: Date
    endDate?: Date
    storeId?: string
  }
): Promise<{
  data: Order[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, COLLECTIONS.ORDERS),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1)
    )

    // 应用筛选条件
    if (filters?.status) {
      q = query(q, where('status', '==', filters.status))
    }
    if (filters?.paymentMethod) {
      q = query(q, where('payment.method', '==', filters.paymentMethod))
    }
    if (filters?.startDate || filters?.endDate) {
      if (filters.startDate) {
        q = query(q, where('createdAt', '>=', Timestamp.fromDate(filters.startDate)))
      }
      if (filters.endDate) {
        q = query(q, where('createdAt', '<=', Timestamp.fromDate(filters.endDate)))
      }
    }
    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }

    // 分页
    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    const orders = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
        payment: {
          ...data.payment,
          paidAt: data.payment?.paidAt?.toDate?.() || data.payment?.paidAt
        }
      } as Order
    })

    return {
      data: orders,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getOrdersPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * 获取交易记录列表（分页）
 */
export const getTransactionsPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    type?: string
    startDate?: Date
    endDate?: Date
    storeId?: string
  }
): Promise<{
  data: Transaction[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, COLLECTIONS.TRANSACTIONS),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1)
    )

    // 应用筛选条件
    if (filters?.type) {
      q = query(q, where('type', '==', filters.type))
    }
    if (filters?.startDate || filters?.endDate) {
      if (filters.startDate) {
        q = query(q, where('createdAt', '>=', Timestamp.fromDate(filters.startDate)))
      }
      if (filters.endDate) {
        q = query(q, where('createdAt', '<=', Timestamp.fromDate(filters.endDate)))
      }
    }
    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }

    // 分页
    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    const transactions = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as Transaction
    })

    return {
      data: transactions,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getTransactionsPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * 获取驻店记录列表（分页）
 */
export const getVisitSessionsPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    status?: string
    userId?: string
    storeId?: string
  }
): Promise<{
  data: VisitSession[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      orderBy('checkInAt', 'desc'),
      limit(pageSize + 1)
    )

    // 应用筛选条件
    if (filters?.status) {
      q = query(q, where('status', '==', filters.status))
    }
    if (filters?.userId) {
      q = query(q, where('userId', '==', filters.userId))
    }
    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }

    // 分页
    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    // 处理数据（参考visitSessions.ts的processVisitSessionData）
    const sessions = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const data = doc.data()
      const redemptions = (data.redemptions || []).map((redemption: any) => ({
        ...redemption,
        redeemedAt: redemption.redeemedAt?.toDate?.() || new Date(redemption.redeemedAt) || new Date()
      }))
      
      return {
        id: doc.id,
        ...data,
        checkInAt: data.checkInAt?.toDate?.() || new Date(data.checkInAt),
        checkOutAt: data.checkOutAt?.toDate?.() || data.checkOutAt,
        calculatedAt: data.calculatedAt?.toDate?.() || data.calculatedAt,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
        redemptions: redemptions.length > 0 ? redemptions : undefined
      } as VisitSession
    })

    return {
      data: sessions,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getVisitSessionsPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * 获取入库单列表（分页）
 */
export const getInboundOrdersPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    storeId?: string
    startDate?: Date
    endDate?: Date
  }
): Promise<{
  data: InboundOrder[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, COLLECTIONS.INBOUND_ORDERS),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1)
    )

    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }
    if (filters?.startDate || filters?.endDate) {
      if (filters.startDate) q = query(q, where('createdAt', '>=', Timestamp.fromDate(filters.startDate)))
      if (filters.endDate) q = query(q, where('createdAt', '<=', Timestamp.fromDate(filters.endDate)))
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    const data = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const d = doc.data()
      return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt?.toDate?.() || new Date(d.createdAt),
        updatedAt: d.updatedAt?.toDate?.() || new Date(d.updatedAt)
      } as InboundOrder
    })

    return {
      data,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getInboundOrdersPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * 获取出库单列表（分页）
 */
export const getOutboundOrdersPaginated = async (
  pageSize: number,
  lastDoc: QueryDocumentSnapshot | null = null,
  filters?: {
    storeId?: string
    startDate?: Date
    endDate?: Date
  }
): Promise<{
  data: OutboundOrder[]
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
}> => {
  try {
    let q: Query = query(
      collection(db, COLLECTIONS.OUTBOUND_ORDERS),
      orderBy('createdAt', 'desc'),
      limit(pageSize + 1)
    )

    if (filters?.storeId) {
      q = query(q, where('storeId', '==', filters.storeId))
    }
    if (filters?.startDate || filters?.endDate) {
      if (filters.startDate) q = query(q, where('createdAt', '>=', Timestamp.fromDate(filters.startDate)))
      if (filters.endDate) q = query(q, where('createdAt', '<=', Timestamp.fromDate(filters.endDate)))
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc))
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs
    const hasMore = docs.length > pageSize

    const data = (hasMore ? docs.slice(0, pageSize) : docs).map(doc => {
      const d = doc.data()
      return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt?.toDate?.() || new Date(d.createdAt),
        updatedAt: d.updatedAt?.toDate?.() || new Date(d.updatedAt)
      } as OutboundOrder
    })

    return {
      data,
      lastDoc: hasMore ? docs[pageSize - 1] : (docs.length > 0 ? docs[docs.length - 1] : null),
      hasMore
    }
  } catch (error) {
    console.error('[getOutboundOrdersPaginated] 查询失败:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}
