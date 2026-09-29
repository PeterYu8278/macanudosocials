import { 
  collection, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  getDocs,
  query,
  where,
  Timestamp, 
  runTransaction
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { Order, User, OutboundOrder } from '../../types';
import { createPointsRecord } from './pointsRecords';
import { createOutboundOrder, getCigarById } from './firestore';
import { calculatePurchaseReward } from '../../utils/purchaseRewards';
/**
 * 创建订单
 */
export const createOrder = async (
  orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'orderNo'>
): Promise<{ success: boolean; orderId?: string; error?: string }> => {
  try {
    const now = new Date();
    const orderNo = `ORD-${now.getTime()}-${Math.floor(Math.random() * 1000)}`;

    let result: { success: boolean; orderId?: string; error?: string };

    // 如果是积分支付，使用事务处理扣分
    if (orderData.payment.method === 'points') {
      result = await runTransaction(db, async (transaction) => {
        const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, orderData.userId);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists()) {
          throw new Error('User not found');
        }

        const userData = userDoc.data() as User;
        const currentPoints = userData.membership?.points || 0;

        if (currentPoints < orderData.total) {
          throw new Error('Insufficient points');
        }

        const newPoints = currentPoints - orderData.total;

        // 1. 扣除积分
        transaction.update(userRef, {
          'membership.points': newPoints,
          updatedAt: Timestamp.fromDate(now)
        });

        // 2. 创建订单
        const orderRef = doc(collection(db, GLOBAL_COLLECTIONS.ORDERS));
        const finalOrderData = {
          ...orderData,
          orderNo,
          status: 'confirmed', // 积分支付直接确认
          payment: {
            ...orderData.payment,
            paidAt: now
          },
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now)
        };
        transaction.set(orderRef, finalOrderData);

        // 3. 创建积分记录
        const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
        transaction.set(pointsRecordRef, {
          userId: orderData.userId,
          userName: userData.displayName || 'Member',
          type: 'spend',
          amount: orderData.total,
          source: 'purchase',
          description: `Shop Purchase: ${orderNo}`,
          relatedId: orderRef.id,
          balance: newPoints,
          createdAt: Timestamp.fromDate(now)
        });

        return { success: true, orderId: orderRef.id };
      });
    } else {
      // 非积分支付：创建待支付订单，并异步奖励消费积分
      const docRef = await addDoc(collection(db, GLOBAL_COLLECTIONS.ORDERS), {
        ...orderData,
        orderNo,
        status: 'pending',
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now)
      });
      result = { success: true, orderId: docRef.id };

      // 奖励消费积分（异步，不阻塞主流程）
      try {
        const { getPointsConfig } = await import('./pointsConfig');
        const config = await getPointsConfig();
        const reward = calculatePurchaseReward(orderData.total, config?.purchase);
        const earnedPoints = reward.points;
        if (earnedPoints > 0) {
          const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, orderData.userId);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            const currentPoints = userData?.membership?.points ?? 0;
            const newPoints = currentPoints + earnedPoints;
            await updateDoc(userRef, { 'membership.points': newPoints, updatedAt: now });
            await createPointsRecord({
              userId: orderData.userId,
              userName: userData?.displayName || '',
              type: 'earn',
              amount: earnedPoints,
              source: 'purchase',
              description: reward.method === 'rebatePercent'
                ? `消费返点 ${reward.rate}%: ${orderNo}`
                : `消费奖励积分: ${orderNo}`,
              relatedId: docRef.id,
              balance: newPoints,
            });
          }
        }
      } catch (pointsError) {
        console.warn('[createOrder] 消费积分奖励失败:', pointsError);
      }
    }

    // 创建出库记录（Stock Card）
    if (result.success && result.orderId && orderData.items?.length > 0) {
      try {
        await createShopOutboundOrder(result.orderId, orderNo, orderData.items, now);
      } catch (outboundError) {
        console.warn('[createOrder] Failed to create outbound record (order still created):', outboundError);
      }
    }

    return result;
  } catch (error: any) {
    console.error('[createOrder] Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 为商城订单创建出库记录（Stock Card）
 */
const createShopOutboundOrder = async (
  orderId: string,
  orderNo: string,
  items: { cigarId: string; quantity: number; price: number; name?: string }[],
  createdAt: Date
): Promise<void> => {
  const outboundItems = [];
  let outboundTotalQty = 0;
  let outboundTotalValue = 0;

  for (const item of items) {
    const cigar = await getCigarById(item.cigarId);
    if (!cigar) continue; // 跳过非实体产品（如费用行）

    const outboundItem = {
      cigarId: item.cigarId,
      cigarName: cigar.name,
      itemType: 'cigar' as const,
      quantity: item.quantity,
      unitPrice: item.price,
      subtotal: item.quantity * item.price
    };

    outboundItems.push(outboundItem);
    outboundTotalQty += item.quantity;
    outboundTotalValue += outboundItem.subtotal;
  }

  if (outboundItems.length > 0) {
    const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
      referenceNo: orderId,
      type: 'sale',
      reason: `商城订单出库: ${orderNo}`,
      items: outboundItems,
      totalQuantity: outboundTotalQty,
      totalValue: outboundTotalValue,
      status: 'completed',
      operatorId: 'system',
      createdAt
    };

    await createOutboundOrder(outboundOrderData);
    console.log(`[createOrder] Outbound record created for order ${orderNo}`);
  }
};

/**
 * 退还订单积分（当订单使用积分支付时）
 * - cancelled: 退还积分 + 创建退还记录 + 更新订单状态
 * - deleted: 退还积分 + 删除原始消费记录（彻底清除痕迹）
 */
export const refundOrderPoints = async (
  orderId: string,
  newStatus: 'cancelled' | 'deleted' = 'cancelled'
): Promise<{ success: boolean; refunded?: number; error?: string }> => {
  try {
    const orderRef = doc(db, GLOBAL_COLLECTIONS.ORDERS, orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return { success: false, error: 'Order not found' };
    }

    const order = { id: orderSnap.id, ...orderSnap.data() } as Order;

    // 只有积分支付的订单需要退还
    if (order.payment.method !== 'points') {
      return { success: true, refunded: 0 };
    }

    // 已取消的订单不重复退还
    if (order.status === 'cancelled') {
      // 删除模式下，即使已取消也要清理积分记录
      if (newStatus === 'deleted') {
        await deleteRelatedPointsRecords(orderId);
      }
      return { success: true, refunded: 0 };
    }

    const now = new Date();

    return await runTransaction(db, async (transaction) => {
      const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, order.userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists()) {
        throw new Error('User not found');
      }

      const userData = userDoc.data() as User;
      const currentPoints = userData.membership?.points || 0;
      const refundAmount = order.total;
      const newPoints = currentPoints + refundAmount;

      // 1. 退还积分
      transaction.update(userRef, {
        'membership.points': newPoints,
        updatedAt: Timestamp.fromDate(now)
      });

      if (newStatus === 'cancelled') {
        // 取消模式：更新订单状态 + 创建退还记录
        transaction.update(orderRef, {
          status: 'cancelled',
          updatedAt: Timestamp.fromDate(now)
        });

        const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
        transaction.set(pointsRecordRef, {
          userId: order.userId,
          userName: userData.displayName || 'Member',
          type: 'earn',
          amount: refundAmount,
          source: 'purchase',
          description: `Order Refund: ${order.orderNo || orderId}`,
          relatedId: orderId,
          balance: newPoints,
          createdAt: Timestamp.fromDate(now)
        });
      }
      // deleted 模式：不更新订单状态（订单即将被删除），不创建退还记录

      return { success: true, refunded: refundAmount };
    });
  } catch (error: any) {
    console.error('[refundOrderPoints] Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 删除与订单关联的所有积分记录
 */
const deleteRelatedPointsRecords = async (orderId: string): Promise<void> => {
  try {
    const recordsRef = collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS);
    const q = query(recordsRef, where('relatedId', '==', orderId));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
      console.log(`[deleteRelatedPointsRecords] Deleted ${snapshot.size} records for order ${orderId}`);
    }
  } catch (error) {
    console.error('[deleteRelatedPointsRecords] Error:', error);
  }
};

/**
 * 取消订单（自动退还积分 + 创建退还记录）
 */
export const cancelOrder = async (
  orderId: string
): Promise<{ success: boolean; refunded?: number; error?: string }> => {
  return refundOrderPoints(orderId, 'cancelled');
};

/**
 * 删除订单前退还积分并清理积分记录
 */
export const deleteOrderWithRefund = async (
  orderId: string
): Promise<{ success: boolean; refunded?: number; error?: string }> => {
  const result = await refundOrderPoints(orderId, 'deleted');
  // 无论退还是否成功，都尝试清理积分记录
  await deleteRelatedPointsRecords(orderId);
  return result;
};
