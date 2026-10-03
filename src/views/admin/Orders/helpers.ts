import dayjs from 'dayjs'
import type { Order, User, Cigar } from '../../../types'

export const getOrderNoteText = (
  note: string | undefined,
  t: (key: string, options?: Record<string, string>) => string
) => {
  if (!note) return '-'
  const redemption = /^驻店兑换订单 \(Session: ([^)]+)\)( \(H\))?$/.exec(note)
  if (!redemption) return note
  return t('ordersAdmin.loungeRedemptionNote', { sessionId: redemption[1] }) + (redemption[2] || '')
}

export const getOrderAddressText = (address: string | undefined, t: (key: string) => string) => {
  if (address === '会所兑换') return t('ordersAdmin.loungeRedemptionAddress')
  return address || '-'
}

// 状态相关辅助函数
export const getStatusColor = (status: string, completedStatusDisplay = false) => {
  switch (status) {
    case 'pending': return 'orange'
    case 'confirmed': return 'blue'
    case 'shipped': return 'purple'
    case 'delivered': return 'green'
    case 'completed': return completedStatusDisplay ? 'green' : 'default'
    case 'cancelled': return 'red'
    default: return 'default'
  }
}

export const getStatusText = (status: string, t: (key: string) => string, completedStatusDisplay = false) => {
  switch (status) {
    case 'pending': return t('ordersAdmin.status.pending')
    case 'confirmed': return t('ordersAdmin.status.confirmed')
    case 'shipped': return t('ordersAdmin.status.shipped')
    case 'delivered': return t('ordersAdmin.status.delivered')
    case 'completed': return t(completedStatusDisplay ? 'ordersAdmin.status.completed' : 'profile.unknown')
    case 'cancelled': return t('ordersAdmin.status.cancelled')
    default: return t('profile.unknown')
  }
}

export const getPaymentText = (method: string, t: (key: string) => string) => {
  switch (method) {
    case 'credit': return t('ordersAdmin.payment.credit')
    case 'paypal': return 'PayPal'
    case 'bank_transfer': return t('ordersAdmin.payment.bankTransfer')
    default: return t('profile.unknown')
  }
}

// 用户信息辅助函数
export const getUserInfo = (userId: string, users: User[]) => {
  const user = users.find(u => u.id === userId)
  if (!user) return userId
  const name = user.displayName || user.email || user.id
  const email = user.email || ''
  return email ? `${name} (${email})` : name
}

export const getUserName = (userId: string, users: User[]) => {
  const user = users.find(u => u.id === userId)
  return user ? (user.displayName || user.email || user.id) : userId
}

export const getUserPhone = (userId: string, users: User[]) => {
  const user = users.find(u => u.id === userId) as any
  return user ? (user?.profile?.phone || '') : ''
}

// 产品信息辅助函数
export const getCigarInfo = (cigarId: string, cigars: Cigar[]) => {
  const cigar = cigars.find(c => c.id === cigarId)
  return cigar ? `${cigar.name} (${cigar.brand})` : cigarId
}

// 过滤和排序辅助函数
export const filterOrders = (
  orders: Order[],
  users: User[],
  keyword: string,
  statusFilter?: string,
  paymentFilter?: string,
  dateRange?: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null,
  cigars?: Cigar[]
) => {
  return orders.filter(order => {
    const kw = keyword.trim().toLowerCase()
    const user = users.find(u => u.id === order.userId)
    const passKw = !kw || 
      order.id.toLowerCase().includes(kw) ||
      (user?.displayName?.toLowerCase().includes(kw)) ||
      (user?.email?.toLowerCase().includes(kw)) ||
      // 允许在 shipping address 栏搜索
      (String((order as any)?.shipping?.address || '').toLowerCase().includes(kw)) ||
      // 允许搜索 invoice no
      (String((order as any)?.invoice?.invoiceNo || '').toLowerCase().includes(kw)) ||
      // 允许在 item 栏搜索：按 cigarId、数量、价格，以及产品名称和品牌
      (Array.isArray(order.items) && order.items.some(it => {
        const fields = [String(it.cigarId || '').toLowerCase(), String(it.quantity || ''), String(it.price || '')]
        
        // 如果提供了 cigars 数组，也搜索产品名称和品牌
        if (cigars && it.cigarId) {
          const cigar = cigars.find(c => c.id === it.cigarId)
          if (cigar) {
            fields.push(
              (cigar.name || '').toLowerCase(),
              (cigar.brand || '').toLowerCase(),
              ((cigar as any).specification || '').toLowerCase()
            )
          }
        }
        
        return fields.some(f => f.includes(kw))
      }))
    
    const passStatus = !statusFilter || order.status === statusFilter
    const passPayment = !paymentFilter || order.payment.method === paymentFilter
    
    const passDate = !dateRange || !dateRange[0] || !dateRange[1] || (
      dayjs(order.createdAt).isAfter(dateRange[0]) && 
      dayjs(order.createdAt).isBefore(dateRange[1])
    )
    
    return passKw && passStatus && passPayment && passDate
  })
}

export const sortOrders = (orders: Order[], sortDesc: boolean) => {
  return [...orders].sort((a, b) => {
    const ta = new Date(a.createdAt as any).getTime()
    const tb = new Date(b.createdAt as any).getTime()
    return sortDesc ? (tb - ta) : (ta - tb)
  })
}

// 产品分组辅助函数
export const groupCigarsByBrand = (cigars: Cigar[]) => {
  const brandToList = new Map<string, Cigar[]>()
  cigars.forEach((c) => {
    const brand = (c as any)?.brand || 'Unknown'
    const list = brandToList.get(brand) || []
    list.push(c)
    brandToList.set(brand, list)
  })
  
  return Array.from(brandToList.entries())
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    .map(([brand, list]) => ({
      brand,
      list: list.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())),
    }))
}
