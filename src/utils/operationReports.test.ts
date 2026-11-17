import { describe, expect, it } from 'vitest';
import type { InventoryMovement, Order, OutboundOrder, RedemptionRecord, User } from '../types';
import { inventoryCustomerFields, mysteryGiftReportRows, reportOrderType } from './operationReports';

const order = (overrides: Partial<Order> = {}) => ({ id: 'shop', userId: 'customer', ...overrides }) as Order;
const movement = (overrides: Partial<InventoryMovement> = {}) => ({ type: 'out', referenceNo: 'shop', ...overrides }) as InventoryMovement;
describe('operation report fields', () => {
  it('exports gift details with inclusive dates, linked orders and original statuses, excluding referral rewards', () => {
    const start = new Date(2026, 9, 11, 0, 0, 0);
    const end = new Date(2026, 9, 11, 23, 59, 59, 999);
    const gift = (id: string, overrides: Partial<RedemptionRecord> = {}) => ({ id, type: 'mystery_gift', userId: 'customer',
      visitSessionId: 'session', redeemedAt: start, cigarId: 'cigar', quantity: 1, status: 'pending', ...overrides }) as RedemptionRecord;
    const rows = mysteryGiftReportRows([gift('first'), gift('last', { redeemedAt: end, status: 'completed' }),
      gift('old', { redeemedAt: new Date(start.getTime() - 1) }), gift('reward', { type: 'referral_reward' })],
    new Map([['customer', 'Member']]), new Map([['cigar', 'Robusto']]), new Map([['session', { orderId: 'order-R' }]]), start, end);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 'Order Type': 'Mystery Gift', 'Linked Order ID': 'order-R', 'Customer': 'Member', 'Product Name': 'Robusto', 'Status': 'pending' });
    expect(rows[1]['Status']).toBe('completed');
    expect(rows[0]).not.toHaveProperty('Total Amount');
  });
  it('classifies current and legacy order types without mistaking manual sales for gifts', () => {
    expect(reportOrderType(order())).toBe('Shop');
    expect(reportOrderType(order({ id: 'ORD-2026-10-0001-E' }))).toBe('Event');
    expect(reportOrderType(order({ source: { type: 'event', eventId: 'event' } }))).toBe('Event');
    expect(reportOrderType(order({ id: 'ORD-2026-10-0001-R' }))).toBe('Redemption');
    expect(reportOrderType(order({ id: 'REDEMPTION-session' }))).toBe('Redemption');
    expect(reportOrderType(order({ source: { type: 'direct', note: 'Lounge redemption order' } }))).toBe('Redemption');
    expect(reportOrderType(order({ id: 'ORD-2026-10-0001-M' }))).toBe('Manual Sale');
    expect(reportOrderType(order({ source: { type: 'direct', note: 'Mystery Gift' } }))).toBe('Mystery Gift');
  });
  it('resolves outbound customers and both supported phone locations', () => {
    const outbound = { id: 'out', userId: 'customer', userName: 'Old Name' } as OutboundOrder;
    const users = new Map([['customer', { id: 'customer', displayName: 'Current Name', email: 'member@example.com', profile: { phone: '+6012345' } } as User]]);
    expect(inventoryCustomerFields(movement({ outboundOrderId: 'out' }), new Map([['out', outbound]]), new Map(), users)).toEqual({
      'Customer ID': 'customer', 'Customer': 'Current Name', 'Customer Phone': '+6012345', 'Customer Email': 'member@example.com',
    });
    users.set('customer', { ...users.get('customer')!, phone: '+6098765' });
    expect(inventoryCustomerFields(movement({ outboundOrderId: 'out' }), new Map([['out', outbound]]), new Map(), users)['Customer Phone']).toBe('+6098765');
  });
  it('falls back to linked sales orders and stored names without inventing contact info', () => {
    const orders = new Map([['shop', order()]]);
    expect(inventoryCustomerFields(movement(), new Map(), orders, new Map())['Customer ID']).toBe('customer');
    expect(inventoryCustomerFields(movement({ outboundOrderId: 'out' }), new Map([['out', { userName: 'Historical Name' } as OutboundOrder]]), new Map(), new Map()))
      .toMatchObject({ 'Customer': 'Historical Name', 'Customer Phone': '-', 'Customer Email': '-' });
  });
  it('does not attribute inbound stock to a customer even if references happen to match', () => {
    expect(inventoryCustomerFields(movement({ type: 'in' }), new Map(), new Map([['shop', order()]]), new Map()))
      .toEqual({ 'Customer ID': '-', 'Customer': '-', 'Customer Phone': '-', 'Customer Email': '-' });
  });
});
