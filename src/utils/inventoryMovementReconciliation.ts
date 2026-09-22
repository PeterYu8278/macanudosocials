import type { InventoryMovement, Order } from '../types'

type OrderForReconciliation = Pick<Order, 'id' | 'items'>

const movementTime = (movement: InventoryMovement): number => {
  const value = movement.createdAt as any
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value))
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

/**
 * Caps order-backed outbound movements at the quantity recorded on the order.
 * Raw movements remain untouched in Firestore; this prevents legacy duplicate
 * outbound rows from reducing displayed stock or inflating FIFO COGS.
 */
export const reconcileOrderOutboundMovements = (
  movements: InventoryMovement[],
  orders: OrderForReconciliation[]
): InventoryMovement[] => {
  const ordersById = new Map(orders.map(order => [order.id, order]))
  const countedByOrderItem = new Map<string, number>()

  const ordered = movements
    .map((movement, index) => ({ movement, index }))
    .sort((a, b) => movementTime(a.movement) - movementTime(b.movement) || a.index - b.index)

  const accepted: Array<{ movement: InventoryMovement; index: number }> = []

  for (const entry of ordered) {
    const { movement, index } = entry
    const referenceNo = movement.referenceNo || ''
    const order = movement.type === 'out' && referenceNo.startsWith('ORD-')
      ? ordersById.get(referenceNo)
      : undefined

    if (!order) {
      accepted.push(entry)
      continue
    }

    const orderedQuantity = order.items
      .filter(item => item.cigarId === movement.cigarId)
      .reduce((total, item) => total + Math.max(0, Number(item.quantity || 0)), 0)
    const key = `${referenceNo}:${movement.cigarId}`
    const alreadyCounted = countedByOrderItem.get(key) || 0
    const remaining = Math.max(0, orderedQuantity - alreadyCounted)
    const movementQuantity = Math.max(0, Number(movement.quantity || 0))
    const acceptedQuantity = Math.min(movementQuantity, remaining)

    if (acceptedQuantity <= 0) continue

    countedByOrderItem.set(key, alreadyCounted + acceptedQuantity)
    accepted.push({
      index,
      movement: acceptedQuantity === movementQuantity
        ? movement
        : { ...movement, quantity: acceptedQuantity }
    })
  }

  return accepted.sort((a, b) => a.index - b.index).map(entry => entry.movement)
}
