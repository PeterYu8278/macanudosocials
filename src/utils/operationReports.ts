import dayjs from 'dayjs';
import type { InventoryMovement, Order, OutboundOrder, RedemptionRecord, User, VisitSession } from '../types';

export function reportOrderType(order: Order): string {
  const identifiers = [order.id, order.orderNo || ''];
  if (order.source?.type === 'event' || identifiers.some(id => /-E$/i.test(id))) return 'Event';
  const note = order.source?.note || '';
  if (/mystery[ _-]?gift|神秘礼物/i.test(note)) return 'Mystery Gift';
  if (identifiers.some(id => /-R$/i.test(id) || /^REDEMPTION-/i.test(id))
    || /驻店兑换|lounge redemption/i.test(note) || order.shipping?.address === '会所兑换') return 'Redemption';
  if (identifiers.some(id => /-M$/i.test(id)) || order.shipping?.address === 'Direct Sales') return 'Manual Sale';
  return 'Shop';
}

export function inventoryCustomerFields(movement: InventoryMovement, outboundOrders: Map<string, OutboundOrder>,
  orders: Map<string, Order>, users: Map<string, User>) {
  const outbound = movement.type === 'out'
    ? outboundOrders.get(movement.outboundOrderId || '') || outboundOrders.get(movement.referenceNo) : undefined;
  const order = movement.type === 'out' ? orders.get(outbound?.orderId || '') || orders.get(movement.referenceNo) : undefined;
  const userId = outbound?.userId || order?.userId;
  const user = userId ? users.get(userId) : undefined;
  return {
    'Customer ID': userId || '-',
    'Customer': user?.displayName || outbound?.userName || user?.email || userId || '-',
    'Customer Phone': user?.phone || user?.profile?.phone || '-',
    'Customer Email': user?.email || '-',
  };
}

export function mysteryGiftReportRows(records: RedemptionRecord[], users: Map<string, string>, cigars: Map<string, string>,
  sessions: Map<string, Pick<VisitSession, 'orderId'>>, startDate?: Date | null, endDate?: Date | null) {
  return records.filter(record => record.type === 'mystery_gift'
    && (!startDate || !dayjs(record.redeemedAt).isBefore(startDate))
    && (!endDate || !dayjs(record.redeemedAt).isAfter(endDate))).map(record => ({
      'Order Type': 'Mystery Gift',
      'Record ID': record.id,
      'Visit Session ID': record.visitSessionId || '-',
      'Linked Order ID': sessions.get(record.visitSessionId || '')?.orderId || '-',
      'Redeemed At': dayjs(record.redeemedAt).format('YYYY-MM-DD HH:mm:ss'),
      'Customer': users.get(record.userId) || record.userName || record.userId,
      'Customer ID': record.userId,
      'Product Name': record.cigarName || cigars.get(record.cigarId) || record.cigarId || '-',
      'Quantity': record.quantity,
      'Status': record.status,
    }));
}
