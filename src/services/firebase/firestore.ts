// Firestore数据库服务
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  arrayUnion,
  arrayRemove,
  FieldValue,
  documentId,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { User, Brand, Cigar, Event, Order, Transaction, InboundOrder, OutboundOrder, InventoryMovement, AuditLogModule } from '../../types';
import { saveAuditLog } from './auditLog';
import { sanitizeForFirestore as _sanitizeForFirestore, toDateOrNull as _toDateOrNull } from './core/sanitize';
export { sanitizeForFirestore, toDateOrNull, convertFirestoreTimestamps } from './core/sanitize';

// 集合名称到模块的映射
const COLLECTION_TO_MODULE: Record<string, AuditLogModule> = {
  [GLOBAL_COLLECTIONS.USERS]: 'users',
  [GLOBAL_COLLECTIONS.MEMBERS]: 'users',
  [GLOBAL_COLLECTIONS.EVENTS]: 'events',
  [GLOBAL_COLLECTIONS.ORDERS]: 'orders',
  [GLOBAL_COLLECTIONS.CIGARS]: 'inventory',
  [GLOBAL_COLLECTIONS.INBOUND_ORDERS]: 'inventory',
  [GLOBAL_COLLECTIONS.OUTBOUND_ORDERS]: 'inventory',
  [GLOBAL_COLLECTIONS.INVENTORY_MOVEMENTS]: 'inventory',
  [GLOBAL_COLLECTIONS.TRANSACTIONS]: 'transactions',
  [GLOBAL_COLLECTIONS.POINTS_RECORDS]: 'transactions',
  [GLOBAL_COLLECTIONS.APP_CONFIG]: 'system',
  [GLOBAL_COLLECTIONS.FEATURE_VISIBILITY]: 'system',
  [GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS]: 'subscription'
};

// 内部使用别名（向后兼容，避免重命名所有调用点）
const sanitizeForFirestore = _sanitizeForFirestore;

// 集合名称常量
export const COLLECTIONS = {
  USERS: GLOBAL_COLLECTIONS.USERS,
  BRANDS: GLOBAL_COLLECTIONS.BRANDS,
  CIGARS: GLOBAL_COLLECTIONS.CIGARS,
  EVENTS: GLOBAL_COLLECTIONS.EVENTS,
  ORDERS: GLOBAL_COLLECTIONS.ORDERS,
  TRANSACTIONS: GLOBAL_COLLECTIONS.TRANSACTIONS,
  INBOUND_ORDERS: GLOBAL_COLLECTIONS.INBOUND_ORDERS,
  OUTBOUND_ORDERS: GLOBAL_COLLECTIONS.OUTBOUND_ORDERS,
  INVENTORY_MOVEMENTS: GLOBAL_COLLECTIONS.INVENTORY_MOVEMENTS,
} as const;

// toDateOrNull 已从 core/sanitize 重新导出，此处保留本地别名供文件内部使用
const toDateOrNull = _toDateOrNull;

const isEventOpenForRegistration = (event: Event): boolean => {
  const now = new Date();
  const status = event.status;
  if (status === 'draft' || status === 'cancelled' || status === 'completed') {
    return false;
  }

  const endDate = toDateOrNull((event as any)?.schedule?.endDate);
  if (endDate && now > endDate) {
    return false;
  }

  const registrationDeadline = toDateOrNull((event as any)?.schedule?.registrationDeadline);
  if (registrationDeadline && now > registrationDeadline) {
    return false;
  }

  return true;
};

// 通用CRUD操作
export const createDocument = async <T>(collectionName: string, data: Omit<T, 'id'>) => {
  
  try {
    const sanitized = sanitizeForFirestore(data);
    
    const now = new Date();
    const docRef = await addDoc(collection(db, collectionName), {
      createdAt: now,
      updatedAt: now,
      ...sanitized,
    });
    
    // 自动记录日志
    const module = COLLECTION_TO_MODULE[collectionName] || 'system';
    await saveAuditLog({
      module,
      action: 'create',
      targetId: docRef.id,
      description: `Created new document in ${collectionName}`,
      details: sanitized
    });
    
    return { success: true, id: docRef.id };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

export const getDocument = async <T>(collectionName: string, id: string): Promise<T | null> => {
  try {
    const docRef = doc(db, collectionName, id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
  } catch (error) {
    return null;
  }
};

export const updateDocument = async <T>(collectionName: string, id: string, data: Partial<T>) => {
  try {
    const docRef = doc(db, collectionName, id);
    
    // 处理点符号路径：Firestore 的 updateDoc 支持点符号路径，但需要确保值不是 undefined
    // 对于点符号路径的键，直接传递给 updateDoc，不经过 sanitizeForFirestore
    const dotNotationFields: Record<string, any> = {};
    const regularFields: Record<string, any> = {};
    
    Object.keys(data).forEach(key => {
      if (key.includes('.')) {
        // 点符号路径：直接使用，但确保值不是 undefined
        const value = (data as any)[key];
        if (value !== undefined) {
          dotNotationFields[key] = value;
        }
      } else {
        // 普通字段：使用 sanitizeForFirestore 处理
        regularFields[key] = (data as any)[key];
      }
    });
    
    const sanitized = sanitizeForFirestore(regularFields);
    
    // 合并点符号路径字段和普通字段
    const finalUpdateData = {
      ...sanitized,
      ...dotNotationFields,
      updatedAt: new Date(),
    };
    
    await updateDoc(docRef, finalUpdateData);

    // 自动记录日志
    const module = COLLECTION_TO_MODULE[collectionName] || 'system';
    await saveAuditLog({
      module,
      action: 'update',
      targetId: id,
      description: `Updated document in ${collectionName}`,
      details: data
    });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

export const deleteDocument = async (collectionName: string, id: string) => {
  try {
    await deleteDoc(doc(db, collectionName, id));

    // 自动记录日志
    const module = COLLECTION_TO_MODULE[collectionName] || 'system';
    await saveAuditLog({
      module,
      action: 'delete',
      targetId: id,
      description: `Deleted document from ${collectionName}`
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

// 用户相关操作
export const getUsers = async (options?: { limit?: number }): Promise<User[]> => {
  try {
    const constraints: QueryConstraint[] = [];
    if (options?.limit) constraints.push(limit(options.limit));
    const q = constraints.length > 0
      ? query(collection(db, COLLECTIONS.USERS), ...constraints)
      : collection(db, COLLECTIONS.USERS);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
  } catch (error) {
    return [];
  }
};

// 兼容命名：仪表板使用 getAllUsers
export const getAllUsers = getUsers;

export const getUserById = async (id: string): Promise<User | null> => {
  return getDocument<User>(COLLECTIONS.USERS, id);
};

export const getUsersByIds = async (ids: string[]): Promise<User[]> => {
  try {
    if (!ids || ids.length === 0) return [];
    const chunkSize = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const chunkResults = await Promise.all(
      chunks.map(chunk =>
        getDocs(query(collection(db, COLLECTIONS.USERS), where(documentId(), 'in', chunk)))
          .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as User)))
      )
    );
    return chunkResults.flat();
  } catch (error) {
    return [];
  }
}

// 推荐关系以被推荐人自己的 referredByUserId 为准，避免依赖推荐人文档中的冗余数组。
export const getReferredUsers = async (referrerId: string): Promise<User[]> => {
  try {
    if (!referrerId) return [];
    const snapshot = await getDocs(query(
      collection(db, COLLECTIONS.USERS),
      where('referral.referredByUserId', '==', referrerId)
    ));
    return snapshot.docs.map(userDoc => ({ id: userDoc.id, ...userDoc.data() } as User));
  } catch (error) {
    console.error('[Firestore Service] getReferredUsers failed:', error);
    return [];
  }
};

// 品牌相关操作
export const getBrands = async (options?: { limit?: number }): Promise<Brand[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.BRANDS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
  } catch (error) {
    return [];
  }
};

export const getBrandById = async (id: string): Promise<Brand | null> => {
  return getDocument<Brand>(COLLECTIONS.BRANDS, id);
};

export const getActiveBrands = async (): Promise<Brand[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.BRANDS), 
      where('status', '==', 'active'),
      orderBy('name', 'asc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
  } catch (error) {
    return [];
  }
};

export const getBrandsByCountry = async (country: string): Promise<Brand[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.BRANDS), 
      where('country', '==', country),
      orderBy('name', 'asc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
  } catch (error) {
    return [];
  }
};

// 雪茄相关操作
export const getCigars = async (options?: { limit?: number }): Promise<Cigar[]> => {
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (options?.limit) constraints.push(limit(options.limit));
  const q = query(collection(db, COLLECTIONS.CIGARS), ...constraints);
  const querySnapshot = await getDocs(q);
  console.log('[getCigars] docs returned:', querySnapshot.docs.length, '| project:', import.meta.env.VITE_FIREBASE_PROJECT_ID);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cigar));
};

export const getCigarById = async (id: string): Promise<Cigar | null> => {
  return getDocument<Cigar>(COLLECTIONS.CIGARS, id);
};

export const getCigarsByBrand = async (brand: string, options?: { limit?: number }): Promise<Cigar[]> => {
  try {
    const constraints: QueryConstraint[] = [where('brand', '==', brand)];
    constraints.push(limit(options?.limit ?? 50));
    const q = query(collection(db, COLLECTIONS.CIGARS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cigar));
  } catch (error) {
    return [];
  }
};

// 活动相关操作
export const getEvents = async (creatorId?: string, storeId?: string, options?: { limit?: number }): Promise<Event[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('schedule.startDate', 'desc')];

    if (creatorId) {
      constraints.push(where('creatorId', '==', creatorId));
    }

    if (storeId) {
      constraints.push(where('storeId', '==', storeId));
    }

    constraints.push(limit(options?.limit ?? 100));

    const q = query(collection(db, COLLECTIONS.EVENTS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Event));
  } catch (error) {
    return [];
  }
};

export const getEventById = async (id: string): Promise<Event | null> => {
  return getDocument<Event>(COLLECTIONS.EVENTS, id);
};

export const getUpcomingEvents = async (): Promise<Event[]> => {
  try {
    const allEvents = await getEvents(undefined, undefined, { limit: 100 });
    const now = new Date();
    return allEvents.filter((event: Event) => {
      if (event.status === 'cancelled') return false;
      const startDate = event.schedule?.startDate;
      if (!startDate) return false;
      const d = (startDate as any)?.toDate ? (startDate as any).toDate() : new Date(startDate as any);
      return d >= now;
    });
  } catch (error) {
    return [];
  }
};

// 活动报名/取消报名
export const registerForEvent = async (eventId: string, userId: string) => {
  try {
    const eventRef = doc(db, COLLECTIONS.EVENTS, eventId);
    const eventSnap = await getDoc(eventRef);

    if (!eventSnap.exists()) {
      return { success: false, error: new Error('Event not found') };
    }

    const event = { id: eventSnap.id, ...eventSnap.data() } as Event;
    if (!isEventOpenForRegistration(event)) {
      return { success: false, error: new Error('Event registration is closed') };
    }

    const registeredUsers = event.participants?.registered || [];
    const maxParticipants = event.participants?.maxParticipants || 0;
    if (maxParticipants > 0 && registeredUsers.length >= maxParticipants && !registeredUsers.includes(userId)) {
      return { success: false, error: new Error('Event is full') };
    }

    await updateDoc(eventRef, {
      'participants.registered': arrayUnion(userId),
      updatedAt: new Date(),
    });

    // 奖励报名积分（异步，不阻塞主流程）
    try {
      const { getPointsConfig } = await import('./pointsConfig');
      const { createPointsRecord } = await import('./pointsRecords');
      const config = await getPointsConfig();
      const registrationPoints = config?.event?.registration ?? 0;
      if (registrationPoints > 0) {
        const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const currentPoints = userData?.membership?.points ?? 0;
          const newPoints = currentPoints + registrationPoints;
          await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
            'membership.points': newPoints,
            updatedAt: new Date(),
          });
          await createPointsRecord({
            userId,
            userName: userData?.displayName || '',
            type: 'earn',
            amount: registrationPoints,
            source: 'event_registration',
            description: `活动报名积分奖励`,
            relatedId: eventId,
            balance: newPoints,
          });
        }
      }
    } catch (pointsError) {
      console.warn('[registerForEvent] 积分奖励失败:', pointsError);
    }

    // 发送活动提醒（异步，不阻塞主流程）
    try {
      const event = await getEventById(eventId);
      if (event) {
        const { sendEventReminderToUser } = await import('../whapi/integrations');
        sendEventReminderToUser(userId, event).catch(error => {
          console.warn('[registerForEvent] 发送活动提醒失败:', error);
        });
      }
    } catch (whapiError) {
      console.warn('[registerForEvent] Whapi 集成失败:', whapiError);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

export const unregisterFromEvent = async (eventId: string, userId: string) => {
  try {
    const eventRef = doc(db, COLLECTIONS.EVENTS, eventId);
    await updateDoc(eventRef, {
      'participants.registered': arrayRemove(userId),
      updatedAt: new Date(),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

// 获取用户参与的活动（已报名 + 已签到）
export const getEventsByUser = async (userId: string): Promise<Event[]> => {
  try {
    const [registeredSnap, checkedInSnap] = await Promise.all([
      getDocs(query(
        collection(db, COLLECTIONS.EVENTS),
        where('participants.registered', 'array-contains', userId)
      )),
      getDocs(query(
        collection(db, COLLECTIONS.EVENTS),
        where('participants.checkedIn', 'array-contains', userId)
      ))
    ]);

    const seen = new Set<string>();
    const events: Event[] = [];
    for (const snap of [registeredSnap, checkedInSnap]) {
      for (const d of snap.docs) {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          events.push({ id: d.id, ...d.data() } as Event);
        }
      }
    }

    return events.sort((a, b) => {
      const toMs = (v: any): number => {
        if (!v) return 0;
        if (v instanceof Date) return v.getTime();
        if (v?.toDate) return v.toDate().getTime();
        return new Date(v).getTime();
      };
      return toMs(b.schedule?.startDate) - toMs(a.schedule?.startDate);
    });
  } catch (error) {
    return [];
  }
};

// 订单相关操作
export const getOrdersByUser = async (userId: string): Promise<Order[]> => {
  try {
    // 只用 where，不用 orderBy（避免 Firestore 复合索引问题）
    const q = query(
      collection(db, COLLECTIONS.ORDERS), 
      where('userId', '==', userId)
    );
    const querySnapshot = await getDocs(q);
    const orders = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
    
    // 在内存中按创建时间降序排序
    return orders.sort((a, b) => {
      const dateA = a.createdAt instanceof Date 
        ? a.createdAt 
        : (a.createdAt as any)?.toDate 
          ? (a.createdAt as any).toDate() 
          : new Date(a.createdAt);
      const dateB = b.createdAt instanceof Date 
        ? b.createdAt 
        : (b.createdAt as any)?.toDate 
          ? (b.createdAt as any).toDate() 
          : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  } catch (error) {
    return [];
  }
};

export const getAllOrders = async (storeId?: string, options?: { limit?: number; startDate?: Date | null; endDate?: Date | null }): Promise<Order[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (storeId) constraints.push(where('storeId', '==', storeId));
    if (options?.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(options.startDate)));
    if (options?.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(options.endDate)));
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.ORDERS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
  } catch (error) {
    return [];
  }
};

// 根据活动参与者雪茄分配自动创建订单
export const createOrdersFromEventAllocations = async (eventId: string): Promise<{ success: boolean; createdOrders: number; updatedOrders: number; error?: Error }> => {
  try {
    // 获取活动详情
    const event = await getEventById(eventId);
    if (!event) {
      throw new Error('活动不存在');
    }

    // 检查活动是否有雪茄分配
    const allocations = (event as any)?.allocations;
    if (!allocations || Object.keys(allocations).length === 0) {
      return { success: true, createdOrders: 0, updatedOrders: 0 };
    }

    // 获取活动日期作为订单日期基准
    const rawEventStart = (event as any)?.schedule?.startDate;
    const eventDate = toDateOrNull(rawEventStart) || new Date();

    const registeredUsers = (event as any)?.participants?.registered || [];
    let createdOrdersCount = 0;
    let updatedOrdersCount = 0;

    // 创建所有分配记录的副本，用于批量更新
    const updatedAllocations = { ...allocations };

    // Pre-fetch all unique cigar IDs referenced across all allocations
    const uniqueCigarIds = new Set<string>();
    for (const userId of registeredUsers) {
      const allocation = allocations[userId];
      if (!allocation) continue;
      const itemRows = (allocation as any)?.items as Array<{ cigarId: string }> | undefined;
      if (Array.isArray(itemRows)) {
        itemRows.forEach(r => r?.cigarId && uniqueCigarIds.add(r.cigarId));
      } else if ((allocation as any).cigarId) {
        uniqueCigarIds.add((allocation as any).cigarId);
      }
    }
    const cigarList = await Promise.all([...uniqueCigarIds].map(id => getCigarById(id)));
    const cigarMap = new Map<string, Cigar>();
    cigarList.forEach(c => c && cigarMap.set(c.id, c));

    // 为每个参与者创建或更新订单
    for (const userId of registeredUsers) {
      const allocation = allocations[userId];
      if (allocation) {
        // 组装订单行：支持多支雪茄 + 活动费用
        const orderItems: { cigarId: string; quantity: number; price: number }[] = []
        let runningTotal = 0

        // 1) 活动费用行：名称由前端展示，这里用标识符保存，不生成出库
        const feeQty = (allocation as any)?.feeQuantity != null ? Number((allocation as any).feeQuantity) : 1
        const feeUnit = (allocation as any)?.feeUnitPrice != null
          ? Number((allocation as any).feeUnitPrice)
          : Number((event as any)?.participants?.fee || 0)
        if (feeUnit > 0 && feeQty > 0) {
          const feeId = String((event as any)?.title || 'EVENT_FEE')
          orderItems.push({ cigarId: feeId, quantity: feeQty, price: feeUnit })
          runningTotal += feeUnit * feeQty
        }

        // 2) 多行雪茄（新结构）
        const itemRows = (allocation as any)?.items as Array<{ cigarId: string; quantity: number; unitPrice?: number }> | undefined
        if (Array.isArray(itemRows) && itemRows.length > 0) {
          for (const row of itemRows) {
            if (!row?.cigarId || !row?.quantity || row.quantity <= 0) continue
            const rowCigar = cigarMap.get(row.cigarId) ?? null
            const unitPrice = (row as any)?.unitPrice != null ? Number((row as any).unitPrice) : (rowCigar?.price || 0)
            orderItems.push({ cigarId: String(row.cigarId), quantity: row.quantity, price: unitPrice })
            runningTotal += unitPrice * row.quantity
          }
        } else if ((allocation as any).cigarId && (allocation as any).quantity > 0) {
          // 3) 兼容旧结构：单行雪茄
          const cigar = cigarMap.get((allocation as any).cigarId) ?? null
          const qty = (allocation as any).quantity || 1
          const unitPrice = (allocation as any).unitPrice != null ? Number((allocation as any).unitPrice) : (cigar?.price || 0)
          if ((allocation as any).cigarId) {
            orderItems.push({ cigarId: String((allocation as any).cigarId), quantity: qty, price: unitPrice })
            runningTotal += unitPrice * qty
          }
        }

        if (orderItems.length > 0) {
          const orderData = {
            userId: userId,
            items: orderItems,
            total: runningTotal,
            status: 'pending' as const,
            source: { type: 'event' as const, eventId },
            payment: {
              method: 'bank_transfer' as const,
              transactionId: `EVENT_${eventId}_${userId}`,
              paidAt: eventDate // 使用活动日期
            },
            shipping: {
              address: String((event as any)?.title || '活动现场领取')
            },
            createdAt: eventDate, // 使用活动日期同步
            updatedAt: new Date()
          };

          // 如果订单已存在，先删除旧的出库记录（确保数据一致性）
          if (allocation.orderId) {
            const oldOutbounds = await getOutboundOrdersByReferenceNo(allocation.orderId);
            for (const ob of oldOutbounds) {
              await deleteOutboundOrder(ob.id);
            }
          }

          let orderId: string;
          let isNewOrder = false;

          // 检查是否已存在订单
          if (allocation.orderId) {
            // 更新现有订单 - 全量覆盖关键字段，包括日期
            const updateData = {
              items: orderData.items,
              total: orderData.total,
              status: orderData.status,
              source: orderData.source,
              payment: orderData.payment,
              shipping: orderData.shipping,
              createdAt: orderData.createdAt, // 覆盖原始日期为活动日期
              updatedAt: new Date()
            };
            const updateResult = await updateDocument(COLLECTIONS.ORDERS, allocation.orderId, updateData);
            if (updateResult.success) {
              orderId = allocation.orderId;
              updatedOrdersCount++;
            } else {
              continue;
            }
          } else {
            // 创建新订单（自定义ID：ORD-YYYY-MM-0000-E，按活动开始日期）
            const year = eventDate.getFullYear();
            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
            const prefix = `ORD-${year}-${month}-`;
            const startOfMonth = new Date(year, eventDate.getMonth(), 1, 0, 0, 0, 0);
            const endOfMonth = new Date(year, eventDate.getMonth() + 1, 0, 23, 59, 59, 999);
            const qCount = query(
              collection(db, COLLECTIONS.ORDERS),
              where('createdAt', '>=', startOfMonth),
              where('createdAt', '<=', endOfMonth)
            );
            const snap = await getDocs(qCount);
            let seq = snap.size + 1;
            let newId = `${prefix}${String(seq).padStart(4, '0')}-E`;
            // 防止并发或同批次生成重复ID：若存在则自增直至唯一
            while (true) {
              const exists = await getDoc(doc(db, COLLECTIONS.ORDERS, newId));
              if (!exists.exists()) break;
              seq += 1;
              newId = `${prefix}${String(seq).padStart(4, '0')}-E`;
            }

            const sanitized = sanitizeForFirestore(orderData);
            await setDoc(doc(db, COLLECTIONS.ORDERS, newId), {
              ...sanitized,
              createdAt: sanitized.createdAt,
              updatedAt: new Date(),
            } as any);
            orderId = newId;
            isNewOrder = true;
            createdOrdersCount++;
          }

          // 为该订单生成/更新出库记录（仅对真实雪茄行生成，不含费用行）
          // 逻辑：不论是新订单还是更新订单，此时旧的已删，创建全新的
          const outboundItems = []
          let outboundTotalQty = 0
          let outboundTotalValue = 0
          
          for (const it of orderItems) {
            // 仅对真实存在的雪茄生成出库记录（费用行不会匹配到实体雪茄）
            const cigar = cigarMap.get(it.cigarId) ?? null
            if (!cigar) continue
            
            const outboundItem = {
              cigarId: it.cigarId,
              cigarName: cigar.name,
              itemType: 'cigar' as const,
              quantity: it.quantity,
              unitPrice: it.price,
              subtotal: it.quantity * it.price
            }
            
            outboundItems.push(outboundItem)
            outboundTotalQty += it.quantity
            outboundTotalValue += outboundItem.subtotal
          }
          
          // 创建出库订单
          if (outboundItems.length > 0) {
            const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
              referenceNo: orderId,
              type: 'event',
              reason: String((event as any)?.title || '活动订单出库'),
              items: outboundItems,
              totalQuantity: outboundTotalQty,
              totalValue: outboundTotalValue,
              status: 'completed',
              operatorId: 'system',
              createdAt: orderData.createdAt || new Date()
            }
            
            await createOutboundOrder(outboundOrderData)
          }

          // 将订单ID存储到分配记录中（更新副本）
          updatedAllocations[userId] = {
            ...allocation,
            orderId: orderId
          };
        }
      }
    }

    // 批量更新所有分配记录
    await updateDocument(COLLECTIONS.EVENTS, eventId, {
      allocations: updatedAllocations
    } as any);

    return { success: true, createdOrders: createdOrdersCount, updatedOrders: updatedOrdersCount };
  } catch (error) {
    return { success: false, createdOrders: 0, updatedOrders: 0, error: error as Error };
  }
};

// 获取推荐人累计成功推荐人数：被推荐人曾成功开通 Annual Pass 即计入。
export const getSuccessfulReferralCount = async (userId: string): Promise<number> => {
  try {
    if (!userId) return 0;
    const referralsRef = collection(db, COLLECTIONS.USERS, userId, 'referrals');
    const q = query(referralsRef, where('membershipActivatedAt', '!=', null));
    const snap = await getDocs(q);
    return snap.size;
  } catch (error) {
    console.warn('[Firestore Service] getSuccessfulReferralCount 失败:', error);
    return 0;
  }
};

// 直接销售创建订单（手动选择用户与商品）
export const createDirectSaleOrder = async (params: { userId: string; items: { cigarId?: string; quantity: number; price?: number }[]; note?: string; createdAt?: Date }) => {
  try {
    const itemsDetailed: { cigarId: string; quantity: number; price: number }[] = []
    let total = 0
    for (const it of params.items) {
      if (!it?.quantity || it.quantity <= 0) continue
      const id = it.cigarId
      if (id) {
        const cigar = await getCigarById(id)
        const unitPrice = it.price != null ? Number(it.price) : (cigar?.price || 0)
        itemsDetailed.push({ cigarId: id, quantity: it.quantity, price: unitPrice })
        total += unitPrice * it.quantity
      } else {
        // 自定义费用行（无 cigarId）
        const unitPrice = Number(it.price || 0)
        if (unitPrice > 0) {
          itemsDetailed.push({ cigarId: `FEE:${Date.now()}`, quantity: it.quantity, price: unitPrice })
          total += unitPrice * it.quantity
        }
      }
    }
    if (itemsDetailed.length === 0) {
      throw new Error('无有效商品项')
    }
    const orderData: Omit<Order, 'id'> = {
      userId: params.userId,
      items: itemsDetailed,
      total,
      status: 'pending',
      source: { type: 'direct', note: params.note },
      payment: { method: 'bank_transfer', transactionId: undefined, paidAt: new Date() },
      shipping: { address: 'Direct Sales' },
      createdAt: params.createdAt || new Date(),
      updatedAt: new Date(),
    }
    // 自定义ID：ORD-YYYY-MM-0000-M
    const now = orderData.createdAt || new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const prefix = `ORD-${year}-${month}-`
    const startOfMonth = new Date(year, now.getMonth(), 1, 0, 0, 0, 0)
    const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59, 999)
    const qCount = query(
      collection(db, COLLECTIONS.ORDERS),
      where('createdAt', '>=', startOfMonth),
      where('createdAt', '<=', endOfMonth)
    )
    const snap = await getDocs(qCount)
    let seq = snap.size + 1
    let newId = `${prefix}${String(seq).padStart(4, '0')}-M`
    // 防止并发或同批次生成重复ID：若存在则自增直至唯一
    while (true) {
      const exists = await getDoc(doc(db, COLLECTIONS.ORDERS, newId))
      if (!exists.exists()) break
      seq += 1
      newId = `${prefix}${String(seq).padStart(4, '0')}-M`
    }

    const sanitized = sanitizeForFirestore(orderData)
    await setDoc(doc(db, COLLECTIONS.ORDERS, newId), {
      ...sanitized,
      createdAt: (sanitized as any)?.createdAt || new Date(),
      updatedAt: new Date(),
    } as any)
    const result = { success: true, id: newId }
    
    // 如果订单创建成功，创建对应的出库记录
    if (result.success) {
      const outboundItems = []
      let outboundTotalQty = 0
      let outboundTotalValue = 0
      
      for (const item of itemsDetailed) {
        const cigar = await getCigarById(item.cigarId)
        if (!cigar) continue
        
        const outboundItem = {
          cigarId: item.cigarId,
          cigarName: cigar.name,
          itemType: 'cigar' as const,
          quantity: item.quantity,
          unitPrice: item.price,
          subtotal: item.quantity * item.price
        }
        
        outboundItems.push(outboundItem)
        outboundTotalQty += item.quantity
        outboundTotalValue += outboundItem.subtotal
      }
      
      // 创建出库订单
      if (outboundItems.length > 0) {
        const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
          referenceNo: result.id,
          type: 'sale',
          reason: '直接销售出库',
          items: outboundItems,
          totalQuantity: outboundTotalQty,
          totalValue: outboundTotalValue,
          status: 'completed',
          operatorId: 'system',
          createdAt: new Date()
        }
        
        await createOutboundOrder(outboundOrderData)
      }
    }
    
    return result
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

// 财务相关操作
export const getAllTransactions = async (storeId?: string, options?: { limit?: number; startDate?: Date | null; endDate?: Date | null }): Promise<Transaction[]> => {
  try {
    const constraints: QueryConstraint[] = [];
    const hasDateFilter = Boolean(options?.startDate || options?.endDate);

    if (storeId) constraints.push(where('storeId', '==', storeId));
    if (options?.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(options.startDate)));
    if (options?.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(options.endDate)));
    if (hasDateFilter) constraints.push(orderBy('createdAt', 'desc'));
    if (options?.limit && hasDateFilter) constraints.push(limit(options.limit));

    const q = query(collection(db, COLLECTIONS.TRANSACTIONS), ...constraints);
    const querySnapshot = await getDocs(q);
    const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));

    transactions.sort((a, b) => {
      const dateA = toDateOrNull((a as any)?.createdAt)?.getTime() || 0;
      const dateB = toDateOrNull((b as any)?.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });

    return options?.limit && !hasDateFilter ? transactions.slice(0, options.limit) : transactions;
  } catch (error) {
    return [];
  }
};

export const getTransactionsByType = async (type: Transaction['type'], options?: { limit?: number }): Promise<Transaction[]> => {
  try {
    const constraints: QueryConstraint[] = [
      where('type', '==', type),
      orderBy('createdAt', 'desc')
    ];
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.TRANSACTIONS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
  } catch (error) {
    return [];
  }
};

export const getTransactionsByDateRange = async (startDate: Date, endDate: Date): Promise<Transaction[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.TRANSACTIONS),
      where('createdAt', '>=', startDate),
      where('createdAt', '<=', endDate),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
  } catch (error) {
    return [];
  }
};

export const createTransaction = async (transactionData: Omit<Transaction, 'id'>) => {
  try {
    // 基于月份生成流水号：TXN-YYYY-MM-0000
    const now = (transactionData as any)?.createdAt instanceof Date ? (transactionData as any).createdAt as Date : new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `TXN-${year}-${month}-`;

    // 统计当月已有记录数量（简单顺序号方案，非强一致性）
    const startOfMonth = new Date(year, now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59, 999);
    const qCount = query(
      collection(db, COLLECTIONS.TRANSACTIONS),
      where('createdAt', '>=', startOfMonth),
      where('createdAt', '<=', endOfMonth)
    );
    const snap = await getDocs(qCount);
    const seq = snap.size + 1;
    const id = `${prefix}${String(seq).padStart(4, '0')}`;

    // 清洗数据并写入固定ID文档
    const sanitized = sanitizeForFirestore(transactionData);
    const payload = {
      ...sanitized,
      createdAt: (sanitized as any)?.createdAt || new Date(),
      updatedAt: new Date(),
    } as any;
    await setDoc(doc(db, COLLECTIONS.TRANSACTIONS, id), payload);
    return { success: true, id };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};


// 实时监听
export const subscribeToCollection = <T>(
  collectionName: string,
  callback: (data: T[]) => void,
  queryConstraints?: any[]
) => {
  const col = collection(db, collectionName);
  const constraints: any[] = queryConstraints && queryConstraints.length > 0 ? [...queryConstraints] : [];
  // Only add a safety limit when the caller passed no constraints at all (fully unbounded listener)
  if (constraints.length === 0) constraints.push(limit(200));
  const q = query(col, ...constraints);

  return onSnapshot(q, (querySnapshot) => {
    const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
    callback(data);
  });
};

// ============================================
// 入库/出库订单管理
// ============================================

/**
 * 获取所有入库订单
 */
export const getAllInboundOrders = async (storeId?: string, options?: { limit?: number; startDate?: Date | null; endDate?: Date | null }): Promise<InboundOrder[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (storeId) constraints.push(where('storeId', '==', storeId));
    if (options?.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(options.startDate)));
    if (options?.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(options.endDate)));
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.INBOUND_ORDERS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InboundOrder));
  } catch (error) {
    return [];
  }
};

/**
 * 按 Document ID 获取单个入库订单（精确查询）
 */
export const getInboundOrderById = async (id: string): Promise<InboundOrder | null> => {
  try {
    const docRef = doc(db, COLLECTIONS.INBOUND_ORDERS, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as InboundOrder;
    }
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * 按单号查询入库订单（可能返回多个，如果不同供应商使用相同单号）
 */
export const getInboundOrdersByReferenceNo = async (referenceNo: string): Promise<InboundOrder[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.INBOUND_ORDERS),
      where('referenceNo', '==', referenceNo),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InboundOrder));
  } catch (error) {
    return [];
  }
};

/**
 * 创建入库订单（同时创建 inventory_movements）
 * 使用 Auto ID 以支持不同供应商的相同单号
 */
export const createInboundOrder = async (orderData: Omit<InboundOrder, 'id' | 'updatedAt'>): Promise<string> => {
  try {
    const referenceNo = orderData.referenceNo;
    
    // 1. 确定统一的创建时间，确保订单和库存流水的创建时间完全一致
    const orderCreatedAt = orderData.createdAt || new Date();
    
    // 2. 创建入库订单（使用 Auto ID）
    const sanitized = sanitizeForFirestore(orderData);
    const docRef = await addDoc(collection(db, COLLECTIONS.INBOUND_ORDERS), {
      ...sanitized,
      createdAt: orderCreatedAt,
      updatedAt: new Date()
    });
    
    const generatedId = docRef.id;  // 自动生成的 Document ID
    
    // 3. 创建对应的 inventory_movements，包含实际的 document ID
    for (const item of orderData.items) {
      const movement = {
        cigarId: item.cigarId,
        cigarName: item.cigarName,
        itemType: item.itemType,
        type: 'in' as const,
        quantity: item.quantity,
        referenceNo: referenceNo,           // 单号（用于显示和搜索）
        orderType: 'inbound' as const,
        inboundOrderId: generatedId,        // 实际的 document ID（用于精确访问）
        reason: orderData.reason,
        unitPrice: item.unitPrice,
        storeId: orderData.storeId,         // 关联门店ID
        createdAt: orderCreatedAt
      };
      
      await createDocument(COLLECTIONS.INVENTORY_MOVEMENTS, movement);
    }
    
    return generatedId;  // 返回自动生成的 ID
  } catch (error) {
    throw error;
  }
};

/**
 * 更新入库订单（使用 Document ID）
 * 当 createdAt 发生变化时，自动同步更新关联的 inventory_movements 的 createdAt
 */
export const updateInboundOrder = async (id: string, updates: Partial<InboundOrder>): Promise<void> => {
  try {
    const sanitized = sanitizeForFirestore(updates);
    await updateDoc(doc(db, COLLECTIONS.INBOUND_ORDERS, id), {
      ...sanitized,
      updatedAt: new Date()
    });

    // 如果 createdAt 发生变化，同步更新关联的 inventory_movements
    if ((updates as any).createdAt) {
      const q = query(
        collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
        where('inboundOrderId', '==', id)
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(movDoc =>
        updateDoc(movDoc.ref, { createdAt: (updates as any).createdAt })
      ));
    }
  } catch (error) {
    throw error;
  }
};

/**
 * 删除入库订单（同时删除关联的 inventory_movements）
 * 使用 Document ID
 */
export const deleteInboundOrder = async (id: string): Promise<void> => {
  try {
    
    if (!id || typeof id !== 'string') {
      throw new Error(`无效的订单ID: ${id}`);
    }
    
    // 1. 删除关联的 movements（通过 inboundOrderId）
    const q = query(
      collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
      where('inboundOrderId', '==', id)
    );
    const snapshot = await getDocs(q);
    await Promise.all(snapshot.docs.map(doc => {
      return deleteDoc(doc.ref);
    }));
    
    // 2. 删除订单
    await deleteDoc(doc(db, COLLECTIONS.INBOUND_ORDERS, id));
  } catch (error) {
    throw error;
  }
};

/**
 * 获取所有出库订单
 */
export const getAllOutboundOrders = async (storeId?: string, options?: { limit?: number; startDate?: Date | null; endDate?: Date | null }): Promise<OutboundOrder[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (storeId) constraints.push(where('storeId', '==', storeId));
    if (options?.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(options.startDate)));
    if (options?.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(options.endDate)));
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.OUTBOUND_ORDERS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutboundOrder));
  } catch (error) {
    return [];
  }
};

/**
 * 按 Document ID 获取单个出库订单（精确查询）
 */
export const getOutboundOrderById = async (id: string): Promise<OutboundOrder | null> => {
  try {
    const docRef = doc(db, COLLECTIONS.OUTBOUND_ORDERS, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as OutboundOrder;
    }
    return null;
  } catch (error) {
    console.error('Error fetching outbound order:', error);
    return null;
  }
};

/**
 * 按单号查询出库订单（可能返回多个）
 */
export const getOutboundOrdersByReferenceNo = async (referenceNo: string): Promise<OutboundOrder[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.OUTBOUND_ORDERS),
      where('referenceNo', '==', referenceNo),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutboundOrder));
  } catch (error) {
    console.error('Error fetching outbound orders by reference:', error);
    return [];
  }
};

/**
 * 创建出库订单（同时创建 inventory_movements）
 * 使用 Auto ID 以支持可能的单号重复
 */
export const createOutboundOrder = async (orderData: Omit<OutboundOrder, 'id' | 'updatedAt'>): Promise<string> => {
  try {
    const referenceNo = orderData.referenceNo;
    
    // 1. 确定统一的创建时间，确保订单和库存流水的创建时间完全一致
    const orderCreatedAt = orderData.createdAt || new Date();
    
    // 2. 创建出库订单（使用 Auto ID）
    const sanitized = sanitizeForFirestore(orderData);
    const docRef = await addDoc(collection(db, COLLECTIONS.OUTBOUND_ORDERS), {
      ...sanitized,
      createdAt: orderCreatedAt,
      updatedAt: new Date()
    });
    
    const generatedId = docRef.id;  // 自动生成的 Document ID
    
    // 3. 创建对应的 inventory_movements，包含实际的 document ID
    for (const item of orderData.items) {
      const movement = {
        cigarId: item.cigarId,
        cigarName: item.cigarName,
        itemType: item.itemType,
        type: 'out' as const,
        quantity: item.quantity,
        referenceNo: referenceNo,           // 单号（用于显示和搜索）
        orderType: 'outbound' as const,
        outboundOrderId: generatedId,       // 实际的 document ID（用于精确访问）
        reason: orderData.reason,
        unitPrice: item.unitPrice,
        storeId: orderData.storeId,         // 关联门店ID
        createdAt: orderCreatedAt
      };
      
      await createDocument(COLLECTIONS.INVENTORY_MOVEMENTS, movement);
    }
    
    return generatedId;  // 返回自动生成的 ID
  } catch (error) {
    console.error('Error creating outbound order:', error);
    throw error;
  }
};

/**
 * 删除出库订单（同时删除关联的 inventory_movements）
 * 使用 Document ID
 */
export const deleteOutboundOrder = async (id: string): Promise<void> => {
  try {
    // 1. 删除关联的 movements（通过 outboundOrderId）
    const q = query(
      collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
      where('outboundOrderId', '==', id)
    );
    const snapshot = await getDocs(q);
    await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
    
    // 2. 删除订单
    await deleteDoc(doc(db, COLLECTIONS.OUTBOUND_ORDERS, id));
  } catch (error) {
    console.error('Error deleting outbound order:', error);
    throw error;
  }
};

/**
 * 更新出库订单（使用 Document ID）
 * 当 createdAt 发生变化时，自动同步更新关联的 inventory_movements 的 createdAt
 */
export const updateOutboundOrder = async (id: string, updates: Partial<OutboundOrder>): Promise<void> => {
  try {
    const sanitized = sanitizeForFirestore(updates);
    await updateDoc(doc(db, COLLECTIONS.OUTBOUND_ORDERS, id), {
      ...sanitized,
      updatedAt: new Date()
    });

    // 如果 createdAt 发生变化，同步更新关联的 inventory_movements
    if ((updates as any).createdAt) {
      const q = query(
        collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
        where('outboundOrderId', '==', id)
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(movDoc =>
        updateDoc(movDoc.ref, { createdAt: (updates as any).createdAt })
      ));
    }
  } catch (error) {
    throw error;
  }
};

/**
 * 获取所有库存变动记录（索引表）
 */
export const getAllInventoryMovements = async (storeId?: string, options?: { limit?: number; startDate?: Date | null; endDate?: Date | null }): Promise<InventoryMovement[]> => {
  try {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (storeId) constraints.push(where('storeId', '==', storeId));
    if (options?.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(options.startDate)));
    if (options?.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(options.endDate)));
    if (options?.limit) constraints.push(limit(options.limit));
    const q = query(collection(db, COLLECTIONS.INVENTORY_MOVEMENTS), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryMovement));
  } catch (error) {
    console.error('Error fetching inventory movements:', error);
    return [];
  }
};

/**
 * 按产品ID获取库存变动记录
 */
export const getInventoryMovementsByCigarId = async (cigarId: string): Promise<InventoryMovement[]> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
      where('cigarId', '==', cigarId),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryMovement));
  } catch (error) {
    console.error('Error fetching movements by cigar ID:', error);
    return [];
  }
};
