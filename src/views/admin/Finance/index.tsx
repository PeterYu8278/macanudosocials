// 财务管理页面
import React, { useEffect, useState, useMemo } from 'react'
import {
  Table, Card, Row, Col, Statistic, Typography, DatePicker, Select, Button,
  Space, message, Modal, Form, InputNumber, Input, Spin, Drawer, Tooltip, Pagination
} from 'antd'
import { DollarOutlined, ShoppingOutlined, CalendarOutlined, ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, EyeOutlined, BarChartOutlined, PieChartOutlined, DeleteOutlined, CheckOutlined, SearchOutlined, CloseOutlined } from '@ant-design/icons'
import OrderDetails from '../Orders/OrderDetails'
import type { Transaction, User, InboundOrder, OutboundOrder, InventoryMovement, Order } from '../../../types'
import { getAllTransactions, getAllOrders, createTransaction, COLLECTIONS, getAllUsers, getUsers, updateDocument, deleteDocument, getCigars, getAllInboundOrders, getAllOutboundOrders, getAllInventoryMovements, getOutboundOrdersByReferenceNo } from '../../../services/firebase/firestore'
import { db } from '../../../config/firebase'
import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore'
// 不再使用服务端分页，改为加载所有数据并使用客户端分页
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { getModalThemeStyles, getModalWidth, getModalTheme, getResponsiveModalConfig } from '../../../config/modalTheme'
import { calculateFifoProfit, aggregateProfitByPeriod, ProfitRecord } from '../../../utils/finance'
import { reconcileOrderOutboundMovements } from '../../../utils/inventoryMovementReconciliation'
import { useAuthStore } from '../../../store/modules/auth'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'

const { Title } = Typography
const { RangePicker } = DatePicker
const { Option } = Select
const { Search } = Input

const AdminFinance: React.FC = () => {
  const { t } = useTranslation()
  const { user: currentUser, isSuperAdmin } = useAuthStore()

  // 权限检查：仅 superAdmin 允许访问财务管理
  if (!isSuperAdmin) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
        color: 'rgba(255, 255, 255, 0.65)'
      }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>🚫</div>
        <Title level={3} style={{ color: '#FFFFFF' }}>{t('common.unauthorized')}</Title>
        <p>{t('financeAdmin.superAdminOnly', '只有超级管理员有权访问财务管理页面')}</p>
      </div>
    )
  }

  const [financeStartDate] = useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d })
  const [financeEndDate] = useState<Date>(() => new Date())

  const { data: transactions, loading: txLoading, refresh: refreshTransactions } = useFirestoreQuery(
    () => getAllTransactions(isSuperAdmin ? undefined : currentUser?.storeId),
    [isSuperAdmin, currentUser?.storeId]
  )
  const { data: orders, refresh: refreshOrders } = useFirestoreQuery(
    () => getAllOrders(isSuperAdmin ? undefined : currentUser?.storeId, { startDate: financeStartDate, endDate: financeEndDate, limit: 500 }),
    [isSuperAdmin, currentUser?.storeId, financeStartDate, financeEndDate]
  )
  const { data: users } = useFirestoreQuery(() => getUsers({ limit: 500 }), [])
  const { data: cigars } = useFirestoreQuery(getCigars)

  // 新架构数据
  const { data: inboundOrders, refresh: refreshInboundOrders } = useFirestoreQuery(
    () => getAllInboundOrders(isSuperAdmin ? undefined : currentUser?.storeId, { startDate: financeStartDate, endDate: financeEndDate, limit: 500 }),
    [isSuperAdmin, currentUser?.storeId, financeStartDate, financeEndDate]
  )
  const { data: outboundOrders } = useFirestoreQuery(
    () => getAllOutboundOrders(isSuperAdmin ? undefined : currentUser?.storeId, { startDate: financeStartDate, endDate: financeEndDate, limit: 500 }),
    [isSuperAdmin, currentUser?.storeId, financeStartDate, financeEndDate]
  )
  const { data: inventoryMovements } = useFirestoreQuery(
    () => getAllInventoryMovements(isSuperAdmin ? undefined : currentUser?.storeId, { startDate: financeStartDate, endDate: financeEndDate, limit: 1000 }),
    [isSuperAdmin, currentUser?.storeId, financeStartDate, financeEndDate]
  )

  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const { item: viewing, open: viewingOpen, openDrawer: openViewing, closeDrawer: closeViewing } = useDetailDrawer<Transaction>()
  const [isEditing, setIsEditing] = useState(false)
  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'profit'>('overview')
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const [editForm] = Form.useForm()
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false

  // 不再使用服务端分页，改为加载所有数据并使用客户端分页
  const [mobileTxTab, setMobileTxTab] = useState<'details' | 'matching'>('details')
  const theme = getModalTheme(true) // 使用暗色主题
  const [selectedDateRange, setSelectedDateRange] = useState<'week' | 'month' | 'year' | null>(null)
  const [productExpandedKeys, setProductExpandedKeys] = useState<React.Key[]>([])
  const { item: viewingOrder, open: viewingOrderOpen, openDrawer: openViewingOrder, closeDrawer: closeViewingOrder } = useDetailDrawer<Order>()
  const [importing, setImporting] = useState(false)
  const [profitPage, setProfitPage] = useState(1)
  const [profitTypeFilter, setProfitTypeFilter] = useState<'all' | 'surplus' | 'deficit'>('all')
  const [importRows, setImportRows] = useState<Array<{
    date: Date
    description: string
    income: number
    expense: number
  }>>([])

  const effectiveInventoryMovements = useMemo(
    () => reconcileOrderOutboundMovements(inventoryMovements, orders),
    [inventoryMovements, orders]
  )

  const parseLooseDate = (raw: string): Date | null => {
    if (!raw) return null
    const s = String(raw).trim()
    let m = dayjs(s)
    if (m.isValid()) return m.toDate()
    const variants = [
      s.replace(/[.]/g, '-'),
      s.replace(/[.]/g, '/'),
      s.replace(/[\/]/g, '-'),
    ]
    for (const v of variants) {
      m = dayjs(v)
      if (m.isValid()) return m.toDate()
    }
    const dm = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
    if (dm) {
      const d = parseInt(dm[1], 10)
      const mo = parseInt(dm[2], 10)
      let y = parseInt(dm[3], 10)
      if (y < 100) y += 2000
      const dt = new Date(y, mo - 1, d)
      if (!isNaN(dt.getTime())) return dt
      const dt2 = new Date(y, d - 1, mo)
      if (!isNaN(dt2.getTime())) return dt2
    }
    const n = new Date(s)
    if (!isNaN(n.getTime())) return n
    return null
  }

  const handlePasteToRows = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData?.getData('text') || ''
    if (!text) return
    e.preventDefault()
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0)
    if (lines.length === 0) return
    const appended: Array<{ date: Date; description: string; income: number; expense: number }> = []
    for (const line of lines) {
      const parts = line.split(/[\t,]/).map(s => s.trim())
      const [dateStr, desc, incomeStr, expenseStr] = [
        parts[0],
        parts[1] || '',
        parts[2] || '0',
        parts[3] || '0'
      ]
      const d = parseLooseDate(dateStr)
      if (!d) continue
      appended.push({
        date: d,
        description: desc,
        income: Number(incomeStr) || 0,
        expense: Number(expenseStr) || 0,
      })
    }
    if (appended.length === 0) {
      message.warning(t('financeAdmin.noLinesToImport'))
      return
    }
    setImportRows(prev => [...prev, ...appended])
  }
  const [form] = Form.useForm()

  // 筛选状态
  const [keyword, setKeyword] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
  // 移除货币筛选

  const toDateSafe = (val: any): Date | null => {
    if (!val) return null
    try {
      let v: any = val
      if (v && typeof v.toDate === 'function') {
        v = v.toDate()
      }
      const d = v instanceof Date ? v : new Date(v)
      return isNaN(d.getTime()) ? null : d
    } catch (error) {
      return null
    }
  }

  const formatYMD = (d: Date | null): string => {
    if (!d) return '-'
    try {
      return dayjs(d).format('YYYY-MM-DD')
    } catch (error) {
      return '-'
    }
  }

  // 当viewing改变时，更新表单值
  useEffect(() => {
    if (viewing && editForm) {
      const formValues = {
        transactionDate: toDateSafe(viewing.createdAt) ? dayjs(toDateSafe(viewing.createdAt)) : dayjs(),
        incomeAmount: viewing.amount > 0 ? viewing.amount : 0,
        expenseAmount: viewing.amount < 0 ? Math.abs(viewing.amount) : 0,
        description: viewing.description,
        relatedId: viewing.relatedId || undefined,
        relatedOrders: (viewing as any)?.relatedOrders || [],
      }
      editForm.setFieldsValue(formValues)
      setIsEditing(false) // 重置编辑状态
    }
  }, [viewing, editForm])

  // 监听表单值变化用于统计显示
  const watchedIncomeAmount = Form.useWatch('incomeAmount', editForm) ?? undefined
  const watchedExpenseAmount = Form.useWatch('expenseAmount', editForm) ?? undefined
  const watchedRelatedOrders = Form.useWatch('relatedOrders', editForm) || []

  // 计算统计值
  const computedIncome = typeof watchedIncomeAmount === 'number' ? watchedIncomeAmount : (viewing ? Math.max(Number(viewing.amount || 0), 0) : 0)
  const computedExpense = typeof watchedExpenseAmount === 'number' ? watchedExpenseAmount : (viewing ? Math.max(-Math.min(Number(viewing.amount || 0), 0), 0) : 0)
  const transactionAmount = Math.abs(computedIncome - computedExpense)
  const totalMatchedAmount = watchedRelatedOrders.reduce((sum: number, item: any) => sum + Number(item?.amount || 0), 0)
  const remainingAmount = transactionAmount - totalMatchedAmount

  // 判断当前交易类型（收入/支出）
  const isExpenseTransaction = useMemo(() => {
    return computedExpense > 0 && computedIncome === 0
  }, [computedIncome, computedExpense])

  // 获取入库单号列表（用于支出交易）
  const inboundReferenceOptions = useMemo(() => {
    return inboundOrders
      .map((order: InboundOrder) => {
        const totalValue = order.totalValue || order.items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0)), 0);

        // 计算已匹配金额
        const matchedAmount = transactions
          .filter(t => {
            const relatedOrders = (t as any)?.relatedOrders || []
            return relatedOrders.some((ro: any) => ro.orderId === order.referenceNo)
          })
          .reduce((sum, t) => {
            const relatedOrders = (t as any)?.relatedOrders || []
            const match = relatedOrders.find((ro: any) => ro.orderId === order.referenceNo)
            return sum + (match ? Number(match.amount || 0) : 0)
          }, 0);

        return {
          referenceNo: order.referenceNo,
          totalQuantity: order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          totalValue,
          matchedAmount,
          isFullyMatched: matchedAmount >= (totalValue - 0.01),
          productCount: order.items.length,
          date: order.createdAt,
          reason: order.reason || ''
        };
      })
      .sort((a, b) => {
        const dateA = a.date?.getTime?.() || 0;
        const dateB = b.date?.getTime?.() || 0;
        return dateB - dateA;
      });
  }, [inboundOrders, transactions]);

  // 获取关联的库存变动记录
  const relatedInventoryMovements = useMemo(() => {
    const orderIds = watchedRelatedOrders
      .map((ro: any) => ro?.orderId)
      .filter(Boolean)

    if (orderIds.length === 0) return []

    // 如果是支出交易，显示入库记录（type: 'in'）
    // 如果是收入交易，显示出库记录（type: 'out'）
    const movementType = isExpenseTransaction ? 'in' : 'out'

    return inventoryMovements
      .filter((movement: InventoryMovement) =>
        orderIds.includes(movement.referenceNo) && movement.type === movementType
      )
      .map((movement: InventoryMovement) => {
        // 同步实际单价：对于进货(In)，从进货单获取；对于出库(Out)，从订单获取
        let syncedUnitPrice = movement.unitPrice;

        if (movement.type === 'in') {
          // 尝试从 InboundOrder 中获取最新单价
          const ibOrder = inboundOrders.find(o => o.referenceNo === movement.referenceNo || o.id === (movement as any).inboundOrderId);
          const ibItem = ibOrder?.items?.find(it => it.cigarId === movement.cigarId);
          if (ibItem && ibItem.unitPrice !== undefined) {
            syncedUnitPrice = ibItem.unitPrice;
          }
        } else if (movement.type === 'out') {
          // 尝试从 OutboundOrder 或 Order 中获取单价
          const obOrder = outboundOrders.find(o => o.referenceNo === movement.referenceNo || o.id === (movement as any).outboundOrderId);
          const obItem = obOrder?.items?.find(it => it.cigarId === movement.cigarId);
          if (obItem && obItem.unitPrice !== undefined) {
            syncedUnitPrice = obItem.unitPrice;
          } else {
            // 兜底：从通用销售订单中获取
            const order = orders.find(o => o.id === movement.referenceNo);
            const orderItem = order?.items?.find((it: any) => it.cigarId === movement.cigarId);
            if (orderItem) syncedUnitPrice = orderItem.price;
          }
        }

        return {
          id: movement.id,
          type: movement.type,
          referenceNo: movement.referenceNo,
          cigarId: movement.cigarId,
          cigarName: movement.cigarName,
          quantity: movement.quantity,
          unitPrice: syncedUnitPrice,
          reason: movement.reason,
          createdAt: movement.createdAt
        }
      })
  }, [watchedRelatedOrders, inventoryMovements, isExpenseTransaction, inboundOrders, outboundOrders, orders])

  // 计算订单匹配状态
  const getOrderMatchStatus = (orderId: string) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return { matched: 0, total: 0, status: 'none' }

    const orderTotal = Number(order.total || 0)
    const matchedAmount = transactions
      .filter(t => {
        const relatedOrders = (t as any)?.relatedOrders || []
        return relatedOrders.some((ro: any) => ro.orderId === orderId)
      })
      .reduce((sum, t) => {
        const relatedOrders = (t as any)?.relatedOrders || []
        const orderMatch = relatedOrders.find((ro: any) => ro.orderId === orderId)
        return sum + (orderMatch ? Number(orderMatch.amount || 0) : 0)
      }, 0)

    if (matchedAmount >= orderTotal) {
      return { matched: matchedAmount, total: orderTotal, status: 'fully' }
    } else if (matchedAmount > 0) {
      return { matched: matchedAmount, total: orderTotal, status: 'partial' }
    } else {
      return { matched: matchedAmount, total: orderTotal, status: 'none' }
    }
  }

  // 检查交易是否已全额配对
  const isTransactionFullyMatched = (transaction: Transaction) => {
    const relatedOrders = (transaction as any)?.relatedOrders || []
    if (relatedOrders.length === 0) return false

    const transactionAmount = Math.abs(Number(transaction.amount || 0))
    const totalMatchedAmount = relatedOrders.reduce((sum: number, ro: any) => {
      return sum + Number(ro.amount || 0)
    }, 0)

    return totalMatchedAmount >= transactionAmount
  }

  // 检查订单是否已全额匹配
  const isOrderFullyMatched = (orderId: string) => {
    const status = getOrderMatchStatus(orderId)
    return status.status === 'fully'
  }

  const refreshData = async () => {
    await Promise.all([
      refreshTransactions(),
      refreshOrders(),
      refreshInboundOrders(),
    ])
  }

  // 删除交易记录
  const handleDeleteTransaction = async (transaction: Transaction) => {
    setDeleting(transaction)
  }

  const confirmDeleteTransaction = async () => {
    if (!deleting) return

    setLoading(true)
    try {
      const result = await deleteDocument(COLLECTIONS.TRANSACTIONS, deleting.id)
      if (result.success) {
        message.success(t('financeAdmin.transactionDeleted'))
        // 重新加载所有交易数据
        await refreshTransactions()
        // 如果正在查看被删除的交易，关闭查看 Modal
        if (viewing?.id === deleting.id) {
          closeViewing()
          setIsEditing(false)
        }
        setDeleting(null)
      } else {
        message.error(t('financeAdmin.deleteFailed'))
      }
    } catch (error) {
      console.error('Delete transaction error:', error)
      message.error(t('financeAdmin.deleteFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 筛选后的数据
  const filteredTransactions = useMemo(() => {
    return transactions.filter(transaction => {
      // 日期筛选
      if (dateRange && dateRange[0] && dateRange[1]) {
        const d = toDateSafe(transaction.createdAt)
        if (!d) return false
        const date = dayjs(d)
        const start = dateRange[0].startOf('day')
        const end = dateRange[1].endOf('day')
        if (!((date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end)))) {
          return false
        }
      }

      // 搜索关键词筛选
      if (keyword.trim()) {
        const searchLower = keyword.toLowerCase()
        const description = (transaction.description || '').toLowerCase()
        const id = (transaction.id || '').toLowerCase()
        const relatedId = (transaction.relatedId || '').toLowerCase()
        const amount = Math.abs(transaction.amount).toString()

        if (!description.includes(searchLower) &&
          !id.includes(searchLower) &&
          !relatedId.includes(searchLower) &&
          !amount.includes(searchLower)) {
          return false
        }
      }

      return true
    })
  }, [transactions, dateRange, keyword])

  // 拆分收入/支出字段并计算累计余额（基于时间顺序）
  const { enriched, balanceMap } = useMemo(() => {
    // 从下到上（当前显示顺序的末行开始）逐笔累加，满足“从下到上”的阅读累计方向
    let running = 0
    const idToBalance = new Map<string, number>()
    for (let i = filteredTransactions.length - 1; i >= 0; i--) {
      const tx = filteredTransactions[i]
      running += tx.amount
      idToBalance.set(tx.id, running)
    }
    const enrichedList = filteredTransactions.map(t => ({
      ...t,
      income: t.amount > 0 ? t.amount : 0,
      expense: t.amount < 0 ? Math.abs(t.amount) : 0,
    }))
    return { enriched: enrichedList, balanceMap: idToBalance }
  }, [filteredTransactions])

  const getAmountDisplay = (amount: number) => {
    const isIncome = amount > 0
    return (
      <span style={{ color: isIncome ? '#52c41a' : '#f5222d' }}>
        {isIncome ? '+' : ''}{Math.abs(amount)}
      </span>
    )
  }

  const columns = [
    {
      title: t('financeAdmin.transactionId'),
      dataIndex: 'id',
      key: 'id',
      width: 180,
      render: (id: string, record: Transaction) => (
        <span style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', whiteSpace: 'normal' }}>
          {id}
          {isTransactionFullyMatched(record) && (
            <CheckOutlined style={{ marginLeft: 6, color: '#52c41a', fontSize: '14px' }} />
          )}
        </span>
      ),
    },
    {
      title: t('financeAdmin.transactionDate'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: any) => formatYMD(toDateSafe(date)),
      sorter: (a: any, b: any) => {
        const da = toDateSafe(a.createdAt)?.getTime() || 0
        const db = toDateSafe(b.createdAt)?.getTime() || 0
        return da - db
      },
    },
    {
      title: t('financeAdmin.description'),
      dataIndex: 'description',
      key: 'description',
      render: (description: string, record: Transaction) => {
        const relatedOrders = (record as any)?.relatedOrders || []
        if (relatedOrders.length === 0) {
          return description
        }
        const orderNos = relatedOrders.map((ro: any) => ro.orderId).join(', ')
        return (
          <div>
            <div>{description}</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
              {t('financeAdmin.relatedOrders')}: {orderNos}
            </div>
          </div>
        )
      }
    },
    // 移除类别与原始金额列，仅显示收入/支出与余额
    {
      title: t('financeAdmin.income'),
      dataIndex: 'income',
      key: 'income',
      render: (v: number) => (v > 0 ? <span style={{ color: '#52c41a' }}>+{Number(v).toFixed(2)}</span> : '0'),
      sorter: (a: any, b: any) => (a.income || 0) - (b.income || 0),
    },
    {
      title: t('financeAdmin.expense'),
      dataIndex: 'expense',
      key: 'expense',
      render: (v: number) => (v > 0 ? <span style={{ color: '#f5222d' }}>-{Number(v).toFixed(2)}</span> : '0'),
      sorter: (a: any, b: any) => (a.expense || 0) - (b.expense || 0),
    },
    {
      title: t('financeAdmin.balance'),
      key: 'balance',
      render: (_: any, record: any) => {
        const v = balanceMap.get(record.id) || 0
        const vf = Number(v)
        const text = vf >= 0 ? vf.toFixed(2) : `-${Math.abs(vf).toFixed(2)}`
        return <span style={{ fontWeight: 600 }}>{text}</span>
      },
      sorter: (a: any, b: any) => (balanceMap.get(a.id) || 0) - (balanceMap.get(b.id) || 0),
    },
    // 移除用户ID列和相关订单列


    {
      title: t('financeAdmin.actions'),
      key: 'action',
      render: (_: any, record: Transaction) => (
        <Space size="small" style={{ justifyContent: 'center', width: '100%' }}>
          <Button type="link" icon={<EyeOutlined />} size="small" onClick={() => {
            openViewing(record)
          }}>
          </Button>
        </Space>
      ),
    },
  ]

  // 计算统计数据（基于选中的日期范围）
  const filteredTransactionsForStats = useMemo(() => {
    // 如果有快捷日期选择，直接基于所有交易记录筛选
    if (selectedDateRange) {
      const now = dayjs()
      let startDate: dayjs.Dayjs

      switch (selectedDateRange) {
        case 'week':
          startDate = now.startOf('week')
          break
        case 'month':
          startDate = now.startOf('month')
          break
        case 'year':
          startDate = now.startOf('year')
          break
        default:
          return transactions
      }

      return transactions.filter(t => {
        const d = toDateSafe(t.createdAt)
        if (!d) return false
        const transactionDate = dayjs(d)
        const start = startDate.startOf('day')
        const end = now.endOf('day')
        return (transactionDate.isAfter(start) || transactionDate.isSame(start)) &&
          (transactionDate.isBefore(end) || transactionDate.isSame(end))
      })
    }

    // 如果没有快捷日期选择，使用筛选后的交易记录（可能包含手动选择的日期范围）
    return filteredTransactions
  }, [transactions, filteredTransactions, selectedDateRange])

  // 统计数据
  const totalRevenue = filteredTransactionsForStats
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0)

  const totalExpenses = Math.abs(filteredTransactionsForStats
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + t.amount, 0))

  const netProfit = totalRevenue - totalExpenses

  // 计算品牌销量统计（基于筛选后的交易记录和日期范围）
  const brandSalesStats = useMemo(() => {
    const brandMap = new Map<string, { quantity: number; amount: number }>()

    // 确定日期范围
    let dateFilter: ((orderDate: any) => boolean) | null = null
    if (selectedDateRange) {
      const now = dayjs()
      let startDate: dayjs.Dayjs

      switch (selectedDateRange) {
        case 'week':
          startDate = now.startOf('week')
          break
        case 'month':
          startDate = now.startOf('month')
          break
        case 'year':
          startDate = now.startOf('year')
          break
        default:
          break
      }

      if (startDate!) {
        const start = startDate.startOf('day')
        const end = now.endOf('day')
        dateFilter = (orderDate: any) => {
          const d = toDateSafe(orderDate)
          if (!d) return false
          const date = dayjs(d)
          return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
        }
      }
    } else if (dateRange && dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf('day')
      const end = dateRange[1].endOf('day')
      dateFilter = (orderDate: any) => {
        const d = toDateSafe(orderDate)
        if (!d) return false
        const date = dayjs(d)
        return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
      }
    }

    orders.forEach(order => {
      // 检查订单日期是否在筛选范围内
      if (dateFilter && !dateFilter(order.createdAt)) {
        return
      }

      const items = (order as any)?.items || []
      items.forEach((item: any) => {
        const cigar = cigars.find(c => c.id === item.cigarId)
        const brand = cigar?.brand || 'Unknown'
        const quantity = Number(item.quantity || 0)
        const amount = Number(item.quantity || 0) * Number(item.price || 0)

        const existing = brandMap.get(brand) || { quantity: 0, amount: 0 }
        brandMap.set(brand, {
          quantity: existing.quantity + quantity,
          amount: existing.amount + amount
        })
      })
    })

    const stats = Array.from(brandMap.entries())
      .map(([brand, data]) => ({ brand, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5) // Top 5 brands

    const maxQuantity = Math.max(...stats.map(s => s.quantity), 1)

    return stats.map(stat => ({
      ...stat,
      percentage: (stat.quantity / maxQuantity) * 100
    }))
  }, [orders, cigars, selectedDateRange, dateRange])

  // 计算选中品牌的产品详情
  const brandProductDetails = useMemo(() => {
    if (!selectedBrand) return []

    const productMap = new Map<string, {
      cigarId: string;
      cigar: any;
      quantity: number;
      amount: number;
      orders: number;
      orderDetails: Array<{ orderId: string; orderDate: string; quantity: number; amount: number; userName: string }>
    }>()

    // 确定日期范围
    let dateFilter: ((orderDate: any) => boolean) | null = null
    if (selectedDateRange) {
      const now = dayjs()
      let startDate: dayjs.Dayjs

      switch (selectedDateRange) {
        case 'week':
          startDate = now.startOf('week')
          break
        case 'month':
          startDate = now.startOf('month')
          break
        case 'year':
          startDate = now.startOf('year')
          break
        default:
          break
      }

      if (startDate!) {
        const start = startDate.startOf('day')
        const end = now.endOf('day')
        dateFilter = (orderDate: any) => {
          const d = toDateSafe(orderDate)
          if (!d) return false
          const date = dayjs(d)
          return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
        }
      }
    } else if (dateRange && dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf('day')
      const end = dateRange[1].endOf('day')
      dateFilter = (orderDate: any) => {
        const d = toDateSafe(orderDate)
        if (!d) return false
        const date = dayjs(d)
        return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
      }
    }

    orders.forEach(order => {
      // 检查订单日期是否在筛选范围内
      if (dateFilter && !dateFilter(order.createdAt)) {
        return
      }

      const items = (order as any)?.items || []
      items.forEach((item: any) => {
        const cigar = cigars.find(c => c.id === item.cigarId)
        // 获取品牌，与品牌摘要统计逻辑保持一致
        const brand = cigar?.brand || 'Unknown'

        // 匹配选中品牌（包括 Unknown 的情况）
        if (brand === selectedBrand) {
          const quantity = Number(item.quantity || 0)
          const amount = Number(item.quantity || 0) * Number(item.price || 0)
          const user = users.find(u => u.id === order.userId)
          const userName = user?.displayName || user?.email || order.userId

          const existing = productMap.get(item.cigarId) || {
            cigarId: item.cigarId,
            cigar: cigar || null,
            quantity: 0,
            amount: 0,
            orders: 0,
            orderDetails: [] as Array<{ orderId: string; orderDate: string; quantity: number; amount: number; userName: string }>
          }

          // 安全转换日期
          let orderDate: string | Date = order.createdAt
          if (orderDate && typeof (orderDate as any).toDate === 'function') {
            orderDate = (orderDate as any).toDate()
          }
          // 转换为字符串或保持 Date 对象
          const orderDateStr = orderDate instanceof Date
            ? orderDate.toISOString()
            : (typeof orderDate === 'string' ? orderDate : new Date().toISOString())

          existing.orderDetails.push({
            orderId: order.id,
            orderDate: orderDateStr,
            quantity,
            amount,
            userName
          })

          productMap.set(item.cigarId, {
            cigarId: item.cigarId,
            cigar: cigar || null,
            quantity: existing.quantity + quantity,
            amount: existing.amount + amount,
            orders: existing.orders + 1,
            orderDetails: existing.orderDetails
          })
        }
      })
    })

    return Array.from(productMap.values())
      .sort((a, b) => b.quantity - a.quantity)
  }, [selectedBrand, orders, cigars, users, selectedDateRange, dateRange])

  // 计算 FIFO 利润数据
  const profitData = useMemo(() => {
    if (!effectiveInventoryMovements.length || !cigars.length) return { records: [], rowSpanMap: {}, totalProfit: 0, totalCogs: 0, totalRevenue: 0, margin: 0, trendData: [], maxVal: 1 }

    const cigarMap = new Map(cigars.map(c => [c.id, c]))
    const inboundMap = new Map(inboundOrders.map(o => [o.id, o]))

    // 1. 同步实际成交价：使变动记录的价格与订单/进货单对齐，并修复产品名称显示
    const syncedMovements = effectiveInventoryMovements.map(m => {
      // 获取关联订单或进货单
      const order = m.referenceNo ? orders.find(o => o.id === m.referenceNo) : null
      const ibOrder = m.inboundOrderId ? inboundMap.get(m.inboundOrderId) : null

      // 设置基准日期：如果是销售订单出库，强制使用订单创建日期作为“业务发生日”
      const baseDate = order ? (toDateSafe(order.createdAt) || m.createdAt) : (toDateSafe(m.createdAt) || new Date())

      // 处理销售出库 (Out) - 确保 Sales 价格与订单一致，日期与订单一致
      if (m.type === 'out' && m.referenceNo && m.referenceNo.startsWith('ORD-')) {
        const orderItem = order?.items?.find((it: any) => it.cigarId === m.cigarId)
        if (orderItem) {
          return {
            ...m,
            createdAt: baseDate, // 修正为订单创建日期
            unitPrice: Number(orderItem.price || 0),
            cigarName: cigarMap.get(m.cigarId)?.name || m.cigarName || m.cigarId
          }
        }
      }

      // 处理采购入库 (In) - 确保 Cost 价格与进货单一致
      if (m.type === 'in' && m.inboundOrderId) {
        if (ibOrder) {
          const ibItem = ibOrder.items?.find((it: any) => (it.cigarId || it.id) === m.cigarId)
          if (ibItem) {
            return {
              ...m,
              createdAt: toDateSafe(m.createdAt) || new Date(),
              unitPrice: Number(ibItem.unitPrice || 0),
              cigarName: cigarMap.get(m.cigarId)?.name || m.cigarName || m.cigarId
            }
          }
        }
      }

      return {
        ...m,
        createdAt: baseDate,
        cigarName: cigarMap.get(m.cigarId)?.name || m.cigarName || m.cigarId
      }
    })

    // 2. 过滤数据
    const validMovements = syncedMovements.filter(m => {
      // 基础过滤：必须是雪茄
      if (m.itemType !== 'cigar') return false

      // 数据一致性检查：对于出库记录，排除幻影变动
      if (m.type === 'out' && m.referenceNo && m.referenceNo.startsWith('ORD-')) {
        const order = orders.find(o => o.id === m.referenceNo)
        if (order) {
          const isAtOrder = order.items?.some((it: any) => it.cigarId === m.cigarId)
          if (!isAtOrder) return false
        }
      }
      return true
    })

    const records = calculateFifoProfit(validMovements)

    // 3. 统计与过滤
    let dateFilter: ((d: Date) => boolean) = () => true
    if (selectedDateRange) {
      const now = dayjs()
      let startDate: dayjs.Dayjs
      switch (selectedDateRange) {
        case 'week': startDate = now.startOf('week'); break
        case 'month': startDate = now.startOf('month'); break
        case 'year': startDate = now.startOf('year'); break
        default: startDate = now.startOf('year')
      }
      const start = startDate.startOf('day')
      const end = now.endOf('day')
      dateFilter = (d: Date) => {
        const date = dayjs(d)
        return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
      }
    } else if (dateRange && dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf('day')
      const end = dateRange[1].endOf('day')
      dateFilter = (d: Date) => {
        const date = dayjs(d)
        return (date.isAfter(start) || date.isSame(start)) && (date.isBefore(end) || date.isSame(end))
      }
    }

    const filteredRecords = records
      .filter(r => {
        // 1. 日期过滤
        if (!dateFilter(toDateSafe(r.date) || new Date())) return false

        // 2. 搜索逻辑（订单号、产品名、顾客名）
        if (keyword.trim()) {
          const kw = keyword.toLowerCase()
          const orderNo = (r.referenceNo || '').toLowerCase()
          const product = (r.cigarName || '').toLowerCase()

          // 根据订单号找到对应的订单和用户名字
          const order = orders.find(o => o.id === r.referenceNo)
          const user = users.find(u => u.id === order?.userId)
          const userName = (user?.displayName || user?.email || '').toLowerCase()

          return orderNo.includes(kw) || product.includes(kw) || userName.includes(kw)
        }

        // 3. 盈余/亏损筛选
        if (profitTypeFilter === 'surplus' && r.profit <= 0) return false
        if (profitTypeFilter === 'deficit' && r.profit >= 0) return false

        return true
      })
      .sort((a, b) => {
        const timeA = toDateSafe(a.date)?.getTime() || 0
        const timeB = toDateSafe(b.date)?.getTime() || 0
        if (timeB !== timeA) return timeB - timeA
        return (a.referenceNo || '').localeCompare(b.referenceNo || '')
      })

    // --- 新逻辑：按订单号进行物理分组，作为分页单位 ---
    const orderGroups: any[] = []
    const groupMap = new Map<string, any>()

    filteredRecords.forEach(r => {
      const key = r.referenceNo || 'no-ref'
      if (!groupMap.has(key)) {
        const orderObj = {
          id: key,
          referenceNo: key,
          date: r.date,
          userId: orders.find(o => o.id === key)?.userId,
          items: [],
          totalRevenue: 0,
          totalProfit: 0,
          totalCogs: 0,
          totalQty: 0
        }
        groupMap.set(key, orderObj)
        orderGroups.push(orderObj)
      }
      const group = groupMap.get(key)
      group.items.push(r)
      group.totalRevenue += r.revenue
      group.totalProfit += r.profit
      group.totalCogs += r.cogs
      group.totalQty += r.quantity
    })

    const totalProfit = filteredRecords.reduce((sum, r) => sum + r.profit, 0)
    const totalCogs = filteredRecords.reduce((sum, r) => sum + r.cogs, 0)
    const totalRevenue = filteredRecords.reduce((sum, r) => sum + r.revenue, 0)

    // 按月份聚合趋势数据（固定显示过去12个月，不受表格过滤影响）
    const now = dayjs()
    const last12MonthsStart = now.subtract(11, 'month').startOf('month')

    const yearRecords = records.filter(r => {
      const d = dayjs(toDateSafe(r.date))
      return d.isAfter(last12MonthsStart) || d.isSame(last12MonthsStart)
    })

    const monthlyData = aggregateProfitByPeriod(yearRecords, 'month')

    const trendData = []
    for (let i = 0; i < 12; i++) {
      const monthKey = last12MonthsStart.add(i, 'month').format('YYYY-MM')
      const existing = monthlyData.find(d => d.date === monthKey)
      trendData.push(existing || { date: monthKey, revenue: 0, profit: 0, cogs: 0, count: 0 })
    }

    const maxVal = Math.max(...trendData.map(d => Math.max(d.revenue, d.profit)), 1)

    return {
      records: orderGroups, // 现在 DataSource 是按订单分组的
      totalProfit,
      totalCogs,
      totalRevenue,
      margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      trendData,
      maxVal
    }
  }, [effectiveInventoryMovements, orders, users, cigars, inboundOrders, selectedDateRange, dateRange, isMobile, keyword, profitTypeFilter])

  // 已移除类别统计

  return (
    <div style={{ minHeight: '80vh' }}>
      {/* 手机端悬浮按钮 */}
      {isMobile && activeTab === 'transactions' && (
        <Button
          type="primary"
          shape="circle"
          icon={<PlusOutlined style={{ fontSize: 24, display: 'flex', justifyContent: 'center', alignItems: 'center' }} />}
          onClick={() => setCreating(true)}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 80,
            width: 56,
            height: 56,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            color: '#221c10',
            border: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            padding: 0
          }}
        />
      )}

      {/* 自定义标签 */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(244,175,37,0.2)', marginBottom: 10 }}>
        {(['overview', 'transactions', 'profit'] as const).map((tabKey) => {
          const isActive = activeTab === tabKey
          const baseStyle: React.CSSProperties = {
            flex: 1,
            padding: '10px 0',
            fontWeight: 800,
            fontSize: 12,
            outline: 'none',
            borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer',
            background: 'none',
          }
          const activeStyle: React.CSSProperties = {
            color: 'transparent',
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            WebkitBackgroundClip: 'text',
          }
          const inactiveStyle: React.CSSProperties = {
            color: '#A0A0A0',
          }
          return (
            <button
              key={tabKey}
              style={{ ...baseStyle, ...(isActive ? activeStyle : inactiveStyle) }}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(`financeAdmin.${tabKey}`)}
            </button>
          )
        })}
      </div>

      {/* 概况标签内容 */}
      {activeTab === 'overview' && (
        <>
          {/* 统计卡片 - Glassmorphism风格 */}
          {isMobile ? (
            <div style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(244, 175, 37, 0.3)',
              display: 'flex',
              gap: 8,
              marginBottom: 10
            }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>
                  {totalRevenue.toFixed(0)}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>
                  {t('financeAdmin.totalRevenue')}
                </div>
              </div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>
                  {totalExpenses.toFixed(0)}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>
                  {t('financeAdmin.totalExpenses')}
                </div>
              </div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: netProfit >= 0 ? '#0bda19' : '#fa3f38' }}>
                  {netProfit.toFixed(0)}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>
                  {t('financeAdmin.netProfit')}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              marginBottom: 10
            }}>
              {/* 总收入卡片 */}
              <div style={{
                padding: 24,
                borderRadius: 12,
                background: 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(244, 175, 37, 0.6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DollarOutlined style={{ color: '#f4af25', fontSize: 20 }} />
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 500 }}>{t('financeAdmin.totalRevenue')}</span>
                </div>
                <div style={{ color: '#fff', fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px' }}>
                  RM{totalRevenue.toFixed(2)}
                </div>
              </div>

              {/* 总支出卡片 */}
              <div style={{
                padding: 24,
                borderRadius: 12,
                background: 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(244, 175, 37, 0.6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShoppingOutlined style={{ color: '#f4af25', fontSize: 20 }} />
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 500 }}>{t('financeAdmin.totalExpenses')}</span>
                </div>
                <div style={{ color: '#fff', fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px' }}>
                  RM{totalExpenses.toFixed(2)}
                </div>
              </div>

              {/* 净利润卡片 */}
              <div style={{
                padding: 24,
                borderRadius: 12,
                background: 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(244, 175, 37, 0.6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {netProfit >= 0 ? <ArrowUpOutlined style={{ color: '#f4af25', fontSize: 20 }} /> : <ArrowDownOutlined style={{ color: '#f4af25', fontSize: 20 }} />}
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 500 }}>{t('financeAdmin.netProfit')}</span>
                </div>
                <div style={{ color: '#fff', fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px' }}>
                  RM{netProfit.toFixed(2)}
                </div>
                <div style={{
                  color: netProfit >= 0 ? '#0bda19' : '#fa3f38',
                  fontSize: 16,
                  fontWeight: 500
                }}>
                  {netProfit >= 0 ? '+' : ''}{totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0}%
                </div>
              </div>
            </div>
          )}

          {/* 日期范围选择器 */}
          <div style={{
            display: 'flex',
            gap: isMobile ? 8 : 12,
            marginBottom: 10,
            overflowX: 'auto',
            paddingBottom: 4,
            justifyContent: isMobile ? 'center' : 'flex-start'
          }}>
            <button
              onClick={() => {
                setSelectedDateRange(null)
                setDateRange(null)
              }}
              style={{
                height: isMobile ? 28 : 32,
                padding: isMobile ? '0 12px' : '0 16px',
                borderRadius: isMobile ? 14 : 16,
                background: !selectedDateRange ? 'rgba(244, 175, 37, 0.6)' : 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: !selectedDateRange ? 'none' : '1px solid rgba(244, 175, 37, 0.6)',
                color: !selectedDateRange ? '#f4af25' : '#fff',
                fontSize: isMobile ? 12 : 14,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {t('financeAdmin.allTime')}
            </button>
            <button
              onClick={() => {
                const now = dayjs()
                const startDate = now.startOf('week')
                setSelectedDateRange('week')
                setDateRange([startDate, now.endOf('day')])
              }}
              style={{
                height: isMobile ? 28 : 32,
                padding: isMobile ? '0 12px' : '0 16px',
                borderRadius: isMobile ? 14 : 16,
                background: selectedDateRange === 'week' ? 'rgba(244, 175, 37, 0.6)' : 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: selectedDateRange === 'week' ? 'none' : '1px solid rgba(244, 175, 37, 0.6)',
                color: selectedDateRange === 'week' ? '#f4af25' : '#fff',
                fontSize: isMobile ? 12 : 14,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {t('financeAdmin.thisWeek')}
            </button>
            <button
              onClick={() => {
                const now = dayjs()
                const startDate = now.startOf('month')
                setSelectedDateRange('month')
                setDateRange([startDate, now.endOf('day')])
              }}
              style={{
                height: isMobile ? 28 : 32,
                padding: isMobile ? '0 12px' : '0 16px',
                borderRadius: isMobile ? 14 : 16,
                background: selectedDateRange === 'month' ? 'rgba(244, 175, 37, 0.6)' : 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: selectedDateRange === 'month' ? 'none' : '1px solid rgba(244, 175, 37, 0.6)',
                color: selectedDateRange === 'month' ? '#f4af25' : '#fff',
                fontSize: isMobile ? 12 : 14,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {t('financeAdmin.thisMonth')}
            </button>
            <button
              onClick={() => {
                const now = dayjs()
                const startDate = now.startOf('year')
                setSelectedDateRange('year')
                setDateRange([startDate, now.endOf('day')])
              }}
              style={{
                height: isMobile ? 28 : 32,
                padding: isMobile ? '0 12px' : '0 16px',
                borderRadius: isMobile ? 14 : 16,
                background: selectedDateRange === 'year' ? 'rgba(244, 175, 37, 0.6)' : 'rgba(57, 51, 40, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: selectedDateRange === 'year' ? 'none' : '1px solid rgba(244, 175, 37, 0.6)',
                color: selectedDateRange === 'year' ? '#f4af25' : '#fff',
                fontSize: isMobile ? 12 : 14,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {t('financeAdmin.thisYear')}
            </button>
          </div>

          {/* 品牌销量图表 */}
          <div style={{
            padding: 24,
            borderRadius: 12,
            background: 'rgba(57, 51, 40, 0.5)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(244, 175, 37, 0.6)',
            marginBottom: 10
          }}>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {t('financeAdmin.brandSalesChart')}
            </div>
            <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14, marginBottom: 10 }}>
              {t('financeAdmin.top5Brands')}
            </div>

            {brandSalesStats.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {brandSalesStats.map((stat, index) => (
                  <div
                    key={stat.brand}
                    onClick={() => setSelectedBrand(stat.brand)}
                    style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                        {index + 1}. {stat.brand}
                      </span>
                      <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: 14 }}>
                        {stat.quantity} {t('financeAdmin.pieces')} · RM{stat.amount.toFixed(2)}
                      </span>
                    </div>
                    <div style={{
                      width: '100%',
                      height: 8,
                      background: 'rgba(244, 175, 37, 0.1)',
                      borderRadius: 4,
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${stat.percentage}%`,
                        height: '100%',
                        background: `linear-gradient(to right, ${index === 0 ? '#f4af25' :
                          index === 1 ? '#d28e19' :
                            index === 2 ? '#b87315' :
                              index === 3 ? '#a0680a' : '#8a5a08'
                          }, ${index === 0 ? '#d28e19' :
                            index === 1 ? '#b87315' :
                              index === 2 ? '#a0680a' :
                                index === 3 ? '#8a5a08' : '#6f4706'
                          })`,
                        borderRadius: 4,
                        transition: 'width 0.5s ease'
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                height: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(244, 175, 37, 0.05)',
                borderRadius: 8,
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: 14
              }}>
                {t('financeAdmin.noSalesData')}
              </div>
            )}
          </div>
        </>
      )}

      {/* 利润分析标签内容 */}
      {activeTab === 'profit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: isMobile ? 'calc(100vh - 190px)' : '80vh', overflow: 'hidden' }}>
          {/* 利润概览卡片 */}
          {isMobile ? (
            <div style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(57, 51, 40, 0.5)',
              border: '1px solid rgba(244, 175, 37, 0.3)',
              display: 'flex',
              gap: 8
            }}>
              {[
                { label: t('financeAdmin.totalProfit'), value: profitData.totalProfit, color: '#f4af25', isRM: true },
                { label: t('financeAdmin.totalRevenue'), value: profitData.totalRevenue, color: '#fff', isRM: true },
                { label: t('financeAdmin.totalCogs'), value: profitData.totalCogs, color: '#fff', isRM: true },
                { label: t('financeAdmin.profitMargin'), value: `${profitData.margin.toFixed(1)}%`, color: '#0bda19', isRM: false },
              ].map((item, idx) => (
                <div key={idx} style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>
                    {item.isRM ? `${(item.value as number).toFixed(0)}` : item.value}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 16
            }}>
              {[
                { label: t('financeAdmin.totalProfit'), value: profitData.totalProfit, color: '#f4af25', icon: <DollarOutlined /> },
                { label: t('financeAdmin.totalRevenue'), value: profitData.totalRevenue, color: '#fff', icon: <BarChartOutlined /> },
                { label: t('financeAdmin.totalCogs'), value: profitData.totalCogs, color: '#fff', icon: <ShoppingOutlined /> },
                { label: t('financeAdmin.profitMargin'), value: `${profitData.margin.toFixed(1)}%`, color: '#0bda19', icon: <ArrowUpOutlined /> },
              ].map((item, idx) => (
                <div key={idx} style={{
                  padding: 20,
                  borderRadius: 12,
                  background: 'rgba(57, 51, 40, 0.5)',
                  border: '1px solid rgba(244, 175, 37, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                    {item.icon}
                    {item.label}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>
                    {typeof item.value === 'number' ? `RM${item.value.toFixed(2)}` : item.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 滚动内容区 */}
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: isMobile ? 0 : 4 }}>
            {/* 趋势图表 - 现代风格 */}
            <div style={{
              padding: '24px 24px 40px 24px',
              borderRadius: 12,
              background: 'rgba(57, 51, 40, 0.5)',
              border: '1px solid rgba(244, 175, 37, 0.6)',
              minHeight: 320
            }}>
              <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
                {t('financeAdmin.profitTrend')} (FIFO)
              </div>

              {profitData.trendData.length > 0 ? (
                <div style={{ position: 'relative' }}>
                  {/* 悬浮提示说明 (Legend) */}
                  <div style={{
                    display: 'flex',
                    gap: 16,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.6)',
                    justifyContent: isMobile ? 'center' : 'flex-end',
                    marginBottom: 20
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 12, background: 'linear-gradient(to top, #C48D3A, #FDE08D)', borderRadius: 3 }} />
                      {t('financeAdmin.totalRevenue')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 12, background: 'linear-gradient(to top, #237804, #52c41a)', borderRadius: 3 }} />
                      {t('financeAdmin.profit')}
                    </div>
                  </div>

                  {/* 可横向滚动的柱状图区域 */}
                  <div style={{
                    overflowX: 'auto',
                    overflowY: 'visible',
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: 20
                  }}>
                    <div style={{
                      height: 250,
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: isMobile ? 8 : 16,
                      paddingBottom: 60, // Increased to avoid labels overlap
                      minWidth: isMobile ? Math.max(profitData.trendData.length * 56, 300) : 'auto'
                    }}>
                      {profitData.trendData.map((d, i) => {
                        const barMonth = dayjs(d.date)
                        const isActive = dateRange &&
                          dateRange[0] &&
                          dateRange[0].isSame(barMonth, 'month') &&
                          dateRange[1] &&
                          dateRange[1].isSame(barMonth, 'month')

                        const chartMaxHeight = 160
                        const revHeight = (d.revenue / profitData.maxVal) * chartMaxHeight
                        const proHeight = (d.profit / profitData.maxVal) * chartMaxHeight

                        const formatVal = (val: number) => {
                          if (val >= 1000) return `${(val / 1000).toFixed(1)}k`
                          return Math.round(val).toString()
                        }

                        return (
                          <div
                            key={i}
                            style={{
                              flex: isMobile ? 'none' : 1,
                              minWidth: isMobile ? 48 : 'auto',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              height: '100%',
                              position: 'relative',
                              cursor: 'pointer',
                              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                              transform: isActive ? 'scale(1.05) translateY(-5px)' : 'none',
                              opacity: (dateRange && !isActive) ? 0.35 : 1
                            }}
                            onClick={() => {
                              if (isActive) {
                                setDateRange(null)
                                setSelectedDateRange(null)
                                message.info(t('financeAdmin.resetFilters'))
                              } else {
                                const start = barMonth.startOf('month')
                                const end = barMonth.endOf('month')
                                setDateRange([start, end])
                                setSelectedDateRange(null)
                                message.info(`${t('common.month')}: ${barMonth.format('MMM YYYY')}`)
                              }
                            }}
                          >
                            <Tooltip
                              title={
                                <div style={{ padding: '8px' }}>
                                  <div style={{ fontWeight: 800, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 4 }}>
                                    {barMonth.format('MMMM YYYY')}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 4 }}>
                                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{t('financeAdmin.totalRevenue')}:</span>
                                    <span style={{ color: '#FDE08D', fontWeight: 700 }}>RM{d.revenue.toLocaleString()}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{t('financeAdmin.profit')}:</span>
                                    <span style={{ color: '#52c41a', fontWeight: 700 }}>RM{d.profit.toLocaleString()}</span>
                                  </div>
                                </div>
                              }
                              overlayInnerStyle={{ backdropFilter: 'blur(12px)', background: 'rgba(34, 28, 16, 0.98)', border: '1px solid rgba(244, 175, 37, 0.5)', borderRadius: 8 }}
                              color="transparent"
                            >
                              <div style={{
                                display: 'flex',
                                alignItems: 'flex-end',
                                gap: 3,
                                width: '100%',
                                justifyContent: 'center',
                                paddingBottom: 4,
                                position: 'relative',
                                zIndex: 2
                              }}>
                                {/* 收入柱 */}
                                <div style={{ width: isMobile ? '40%' : '35%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                  {d.revenue > 0 && (
                                    <div style={{ fontSize: 9, color: '#FDE08D', fontWeight: 800, marginBottom: 4, whiteSpace: 'nowrap' }}>
                                      {formatVal(d.revenue)}
                                    </div>
                                  )}
                                  <div style={{
                                    height: Math.max(revHeight, 2),
                                    width: '100%',
                                    background: isActive ? '#FDE08D' : 'linear-gradient(to top, #C48D3A, #FDE08D)',
                                    borderRadius: '3px 3px 0 0',
                                    boxShadow: isActive ? '0 0 15px rgba(253,224,141,0.5)' : 'none',
                                    transition: 'all 0.3s ease'
                                  }} />
                                </div>

                                {/* 利润柱 */}
                                <div style={{ width: isMobile ? '40%' : '35%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                  {d.profit > 0 && (
                                    <div style={{ fontSize: 9, color: '#52c41a', fontWeight: 800, marginBottom: 4, whiteSpace: 'nowrap' }}>
                                      {formatVal(d.profit)}
                                    </div>
                                  )}
                                  <div style={{
                                    height: Math.max(proHeight, 2),
                                    width: '100%',
                                    background: isActive ? '#52c41a' : 'linear-gradient(to top, #237804, #52c41a)',
                                    borderRadius: '3px 3px 0 0',
                                    boxShadow: isActive ? '0 0 15px rgba(82,196,26,0.4)' : 'none',
                                    transition: 'all 0.3s ease'
                                  }} />
                                </div>
                              </div>
                            </Tooltip>

                            {/* 月份底栏文字 */}
                            <div style={{
                              marginTop: 14,
                              fontSize: 9,
                              fontWeight: isActive ? 800 : 500,
                              color: isActive ? '#FDE08D' : '#bab09c',
                              textAlign: 'center',
                              lineHeight: 1.1,
                              transition: 'all 0.3s ease',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center'
                            }}>
                              <div style={{ fontWeight: 700 }}>{barMonth.format('MMM')}</div>
                              <div style={{ opacity: 0.7, fontSize: 8 }}>{barMonth.format('YYYY')}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)' }}>
                  {t('financeAdmin.noSalesData')}
                </div>
              )}
            </div>

            {/* 利润明细搜索和表格 */}
            <div style={{
              padding: 16,
              background: 'rgba(57, 51, 40, 0.5)',
              border: '1px solid rgba(244, 175, 37, 0.6)',
              borderRadius: 12,
              marginBottom: 16,
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              gap: 16,
              marginTop: 10 // Added space between chart and details
            }}>
              <div style={{ display: 'flex', gap: 12, width: isMobile ? '100%' : 'auto', flexDirection: isMobile ? 'column' : 'row' }}>
                <Search
                  placeholder={t('financeAdmin.searchPlaceholder')}
                  allowClear
                  style={{ width: isMobile ? '100%' : 350 }}
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value)
                    setProfitPage(1) // 搜索时重置分页
                  }}
                  className="points-config-form"
                />
                <Select
                  value={profitTypeFilter}
                  onChange={(val) => {
                    setProfitTypeFilter(val)
                    setProfitPage(1)
                  }}
                  style={{ width: isMobile ? '100%' : 160 }}
                  className="points-config-form"
                  dropdownStyle={{ background: '#221c10', border: '1px solid rgba(244,175,37,0.3)' }}
                >
                  <Option value="all">{t('financeAdmin.allRecords', '全部记录')}</Option>
                  <Option value="surplus">
                    <span style={{ color: '#52c41a' }}>📈 {t('financeAdmin.surplus', '盈余')}</span>
                  </Option>
                  <Option value="deficit">
                    <span style={{ color: '#ff4d4f' }}>📉 {t('financeAdmin.deficits', '亏损')}</span>
                  </Option>
                </Select>
              </div>
            </div>

            {/* 利润明细表格 */}
            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {profitData.records.slice((profitPage - 1) * 10, profitPage * 10).map((r: any) => {
                  const user = users.find(u => u.id === r.userId)
                  const status = getOrderMatchStatus(r.referenceNo)
                  let statusColor = 'rgba(255,255,255,0.4)'
                  let statusText = t('financeAdmin.status.unmatched') || '未对账'

                  if (status.status === 'fully') {
                    statusColor = '#52c41a'
                    statusText = t('financeAdmin.status.paid') || '已结清'
                  } else if (status.status === 'partial') {
                    statusColor = '#1890ff'
                    statusText = t('financeAdmin.status.partial') || '部分'
                  }

                  return (
                    <div key={r.id} style={{
                      padding: 16,
                      background: 'rgba(57, 51, 40, 0.5)',
                      border: '1px solid rgba(244, 175, 37, 0.3)',
                      borderRadius: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12
                    }}>
                      {/* 卡片头部 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{formatYMD(toDateSafe(r.date))}</div>
                          <div
                            style={{ color: '#f4af25', fontWeight: 700, fontSize: 15, textDecoration: 'underline', cursor: 'pointer' }}
                            onClick={() => {
                              const order = orders.find(o => o.id === r.referenceNo)
                              if (order) openViewingOrder(order)
                              else message.warning(t('common.noData'))
                            }}
                          >
                            {r.referenceNo}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: `${statusColor}15`,
                          color: statusColor,
                          border: `1px solid ${statusColor}33`,
                          fontWeight: 800
                        }}>
                          {statusText}
                        </div>
                      </div>

                      <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                        👤 {user?.displayName || user?.email || r.userId || '-'}
                      </div>

                      {/* 商品列表 */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 8 }}>
                        {r.items.map((it: any, idx: number) => (
                          <div key={it.id || idx} style={{
                            padding: '8px 0',
                            borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, flex: 1, marginRight: 8 }}>
                                {cigars.find(c => c.id === it.cigarId)?.name || it.cigarName || it.cigarId}
                              </span>
                              <span style={{ color: '#f4af25', fontWeight: 700 }}>x{it.quantity}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                              <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                                RM{it.revenue.toFixed(2)} - RM{it.cogs.toFixed(2)}
                              </span>
                              <span style={{ color: it.profit >= 0 ? '#52c41a' : '#f5222d', fontWeight: 600 }}>
                                {it.profit >= 0 ? '+' : ''}RM{it.profit.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 卡片底部：总计 */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: 8,
                        borderTop: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{t('ordersAdmin.orderTotal')}</span>
                          <span style={{ color: '#f4af25', fontSize: 15, fontWeight: 800 }}>RM{r.totalRevenue.toFixed(2)}</span>
                        </div>
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                          <span style={{ color: r.totalProfit >= 0 ? '#52c41a' : '#f5222d', fontSize: 15, fontWeight: 800 }}>
                            {r.totalProfit >= 0 ? '+' : ''}RM{r.totalProfit.toFixed(2)}
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600 }}>
                            Margin: {r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100).toFixed(1) : 0}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}

                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                  <Pagination
                    simple
                    current={profitPage}
                    pageSize={10}
                    total={profitData.records.length}
                    onChange={(page) => setProfitPage(page)}
                    className="ant-pagination-dark"
                  />
                </div>
              </div>
            ) : (
              <div className="points-config-form">
                <Table
                  dataSource={profitData.records}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    {
                      title: t('financeAdmin.transactionDate'),
                      dataIndex: 'date',
                      render: (d: any) => formatYMD(toDateSafe(d)),
                    },
                    {
                      title: t('ordersAdmin.orderNo'),
                      dataIndex: 'referenceNo',
                      render: (v: string) => {
                        const status = getOrderMatchStatus(v)
                        let statusColor = 'rgba(255,255,255,0.4)'
                        let statusText = t('financeAdmin.status.unmatched') || '未对账'

                        if (status.status === 'fully') {
                          statusColor = '#52c41a'
                          statusText = t('financeAdmin.status.paid') || '已结清'
                        } else if (status.status === 'partial') {
                          statusColor = '#1890ff'
                          statusText = t('financeAdmin.status.partial') || '部分'
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span
                              style={{
                                fontWeight: 700,
                                color: '#f4af25',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                fontSize: 13
                              }}
                              onClick={() => {
                                const order = orders.find(o => o.id === v)
                                if (order) openViewingOrder(order)
                                else message.warning(t('common.noData'))
                              }}
                            >
                              {v || '-'}
                            </span>
                            <div style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: `${statusColor}15`,
                              color: statusColor,
                              border: `1px solid ${statusColor}33`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              width: 'fit-content',
                              fontWeight: 800,
                              lineHeight: 1.2
                            }}>
                              {statusText}
                            </div>
                          </div>
                        )
                      }
                    },
                    {
                      title: t('ordersAdmin.user'),
                      key: 'customer',
                      render: (_: any, r: any) => {
                        const user = users.find(u => u.id === r.userId)
                        return (
                          <div>
                            <div style={{ fontWeight: 600, color: '#fff' }}>{user?.displayName || user?.email || r.userId || '-'}</div>
                          </div>
                        )
                      }
                    },
                    {
                      title: t('financeAdmin.productName'),
                      key: 'productName',
                      render: (_: any, r: any) => (
                        <div>
                          {r.items.map((it: any, idx: number) => (
                            <div key={it.id || idx} style={{
                              padding: '6px 0',
                              borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                              minHeight: 32,
                              display: 'flex',
                              alignItems: 'center'
                            }}>
                              {cigars.find(c => c.id === it.cigarId)?.name || it.cigarName || it.cigarId}
                            </div>
                          ))}
                          {r.items.length > 1 && (
                            <div style={{
                              borderTop: '1px solid transparent',
                              marginTop: 4,
                              paddingTop: 4,
                              fontWeight: 700,
                              color: 'rgba(255,255,255,0.4)',
                              minHeight: 25,
                              display: 'flex',
                              alignItems: 'center'
                            }}>
                              {t('ordersAdmin.orderTotal') || '订单总计'}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: t('financeAdmin.quantity'),
                      key: 'quantity',
                      align: 'right',
                      render: (_: any, r: any) => (
                        <div>
                          {r.items.map((it: any, idx: number) => (
                            <div key={it.id || idx} style={{
                              padding: '6px 0',
                              borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                              minHeight: 32,
                              textAlign: 'right',
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              {it.quantity}
                            </div>
                          ))}
                          {r.items.length > 1 && (
                            <div style={{
                              borderTop: '1px solid transparent',
                              marginTop: 4,
                              paddingTop: 4,
                              fontWeight: 700,
                              minHeight: 25,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              {r.totalQty}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: t('financeAdmin.revenue'),
                      key: 'revenue',
                      align: 'right',
                      render: (_: any, r: any) => (
                        <div>
                          {r.items.map((it: any, idx: number) => (
                            <div key={it.id || idx} style={{
                              padding: '6px 0',
                              borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                              minHeight: 32,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              RM{it.revenue.toFixed(2)}
                            </div>
                          ))}
                          {r.items.length > 1 && (
                            <div style={{
                              borderTop: '1px solid #f4af25',
                              marginTop: 4,
                              paddingTop: 4,
                              fontWeight: 700,
                              color: '#f4af25',
                              minHeight: 25,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              RM{r.totalRevenue.toFixed(2)}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: t('financeAdmin.cost'),
                      key: 'cost',
                      align: 'right',
                      render: (_: any, r: any) => (
                        <div>
                          {r.items.map((it: any, idx: number) => (
                            <div key={it.id || idx} style={{
                              padding: '6px 0',
                              borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                              minHeight: 32,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              RM{it.cogs.toFixed(2)}
                            </div>
                          ))}
                          {r.items.length > 1 && (
                            <div style={{
                              borderTop: '1px solid rgba(255,255,255,0.2)',
                              marginTop: 4,
                              paddingTop: 4,
                              fontWeight: 700,
                              minHeight: 25,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              RM{r.totalCogs.toFixed(2)}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: t('financeAdmin.profit'),
                      key: 'profit',
                      align: 'right',
                      render: (_: any, r: any) => (
                        <div>
                          {r.items.map((it: any, idx: number) => {
                            const p = it.profit;
                            return (
                              <div key={it.id || idx} style={{
                                padding: '6px 0',
                                borderBottom: idx === r.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                                minHeight: 32,
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                                color: p >= 0 ? '#52c41a' : '#f5222d',
                                fontWeight: 600
                              }}>
                                RM{p.toFixed(2)}
                              </div>
                            )
                          })}
                          {r.items.length > 1 && (
                            <div style={{
                              borderTop: '1px solid rgba(255,255,255,0.2)',
                              marginTop: 4,
                              paddingTop: 4,
                              fontWeight: 800,
                              color: r.totalProfit >= 0 ? '#52c41a' : '#f5222d',
                              minHeight: 25,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              alignItems: 'center'
                            }}>
                              RM{r.totalProfit.toFixed(2)}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: t('financeAdmin.margin'),
                      key: 'margin',
                      align: 'right',
                      render: (_: any, r: any) => (
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                          {r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100).toFixed(1) : 0}%
                        </span>
                      )
                    }
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 交易记录标签内容 */}
      {activeTab === 'transactions' && (
        <>
          {/* 筛选器 */}
          {!isMobile ? (
            <div style={{
              marginBottom: 16,
              padding: '16px',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              border: '1px solid rgba(244, 175, 37, 0.6)',
              backdropFilter: 'blur(10px)'
            }}>
              <Space size="middle" wrap>
                <Search
                  placeholder={t('financeAdmin.searchPlaceholder')}
                  allowClear
                  style={{ width: 300 }}
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="points-config-form"
                />
                <RangePicker
                  placeholder={[t('financeAdmin.startDate'), t('financeAdmin.endDate')]}
                  value={dateRange}
                  onChange={(dates) => {
                    setDateRange(dates)
                    // 手动选择日期时清除快捷按钮状态
                    if (dates) {
                      setSelectedDateRange(null)
                    }
                  }}
                  className="points-config-form"
                />
                <Button
                  onClick={() => {
                    setKeyword('')
                    setDateRange(null)
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.resetFilters')}
                </Button>
                <Button
                  onClick={() => {
                    const header = ['id', 'income', 'expense', 'description', 'transactionDate']
                    const rows = filteredTransactions.map(t => [
                      t.id,
                      t.amount > 0 ? t.amount : 0,
                      t.amount < 0 ? Math.abs(t.amount) : 0,
                      t.description,
                      dayjs(t.createdAt).format('YYYY-MM-DD HH:mm')
                    ])
                    const csv = [header.join(','), ...rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'transactions.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.exportReport')}
                </Button>
                <Button
                  onClick={() => setImporting(true)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.pasteImport')}
                </Button>
              </Space>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <Search
                  placeholder={t('financeAdmin.searchPlaceholder')}
                  allowClear
                  style={{ width: '100%' }}
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="points-config-form"
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <RangePicker
                  style={{ width: '100%' }}
                  placeholder={[t('financeAdmin.startDate'), t('financeAdmin.endDate')]}
                  value={dateRange}
                  onChange={(dates) => {
                    setDateRange(dates)
                    if (dates) setSelectedDateRange(null)
                  }}
                  className="points-config-form"
                />
              </div>
              <div style={{ display: 'flex' }}>
                <Button
                  onClick={() => {
                    setKeyword('')
                    setDateRange(null)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.resetShort')}
                </Button>
                <Button
                  onClick={() => {
                    const header = ['id', 'income', 'expense', 'description', 'transactionDate']
                    const rows = filteredTransactions.map(t => [
                      t.id,
                      t.amount > 0 ? t.amount : 0,
                      t.amount < 0 ? Math.abs(t.amount) : 0,
                      t.description,
                      dayjs(t.createdAt).format('YYYY-MM-DD HH:mm')
                    ])
                    const csv = [header.join(','), ...rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'transactions.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.exportShort')}
                </Button>
                <Button
                  onClick={() => setImporting(true)}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                  {t('financeAdmin.importShort')}
                </Button>
              </div>
            </div>
          )}

          {!isMobile ? (
            <div className="points-config-form">
              <Table
                columns={columns}
                dataSource={enriched}
                rowKey="id"
                loading={txLoading || loading}
                style={{
                  background: 'transparent'
                }}
                scroll={{
                  y: 'calc(100vh - 400px)', // 启用虚拟滚动
                  x: 'max-content'
                }}
                pagination={{
                  pageSize: isMobile ? 10 : 20,
                  total: enriched.length,
                  showSizeChanger: true,
                  showQuickJumper: true,
                  showTotal: (total, range) => t('common.paginationTotal', { start: range[0], end: range[1], total }),
                  pageSizeOptions: ['10', '20', '50', '100'],
                }}
              />
            </div>
          ) : (
            <div
              style={{
                overflowY: 'auto',
                overflowX: 'hidden',
                maxHeight: 'calc(100vh - 300px)',
                paddingTop: 8,
                paddingBottom: 80, // Add extra padding to avoid overlap with FAB
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              {enriched.map((transaction: any) => (
                <div key={transaction.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(6px)'
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ color: '#ffffff', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {transaction.id}
                        {isTransactionFullyMatched(transaction) && (
                          <CheckOutlined style={{ marginLeft: 6, color: '#52c41a', fontSize: '14px' }} />
                        )}
                      </div>
                      <div style={{ color: '#ffffff', fontSize: 12 }}>{formatYMD(toDateSafe(transaction.createdAt))}</div>
                    </div>
                    <div style={{ marginTop: 6, color: '#ffffff', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {transaction.description}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                      <div style={{
                        color: transaction.amount >= 0 ? '#52c41a' : '#ff4d4f',
                        fontWeight: 600
                      }}>
                        {transaction.amount >= 0 ? '+' : ''}{transaction.amount.toFixed(2)}
                      </div>
                      <div style={{ color: '#ffffff' }}>
                        {t('financeAdmin.balance')}: RM{(balanceMap.get(transaction.id) || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="link"
                    icon={<EyeOutlined />}
                    size="small"
                    onClick={() => {
                      openViewing(transaction)
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 交易详情（可编辑） */}
      <Modal
        open={viewingOpen}
        onCancel={() => {
          closeViewing()
          setIsEditing(false)
        }}
        footer={[
          <button key="cancel" type="button" onClick={() => {
            closeViewing()
            setIsEditing(false)
          }} style={theme.button.secondary}>
            {t('common.cancel')}
          </button>,
          <button key="delete" type="button" onClick={() => viewing && handleDeleteTransaction(viewing)} disabled={loading} style={theme.button.danger}>
            {t('common.delete')}
          </button>,
          !isEditing ? (
            <button key="edit" type="button" className="cigar-btn-gradient" onClick={() => {
              setIsEditing(true)
            }} style={theme.button.primary}>
              {t('common.edit')}
            </button>
          ) : (
            <button key="save" type="button" className="cigar-btn-gradient" onClick={() => {
              editForm.submit()
            }} style={theme.button.primary}>
              {t('common.save')}
            </button>
          )
        ]}
        width={getModalWidth(isMobile, 960)}
        destroyOnHidden
        centered
        styles={getModalThemeStyles(isMobile, true)}
      >
        {viewing && (
          <>
            {isMobile && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(244,175,37,0.2)' }}>
                  {(['details', 'matching'] as const).map((tabKey) => {
                    const isActive = mobileTxTab === tabKey
                    const baseStyle: React.CSSProperties = {
                      flex: 1,
                      padding: '10px 0',
                      fontWeight: 800,
                      fontSize: 12,
                      outline: 'none',
                      borderBottom: '2px solid transparent',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      position: 'relative' as const,
                    }
                    const activeStyle: React.CSSProperties = {
                      color: 'transparent',
                      backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      WebkitBackgroundClip: 'text',
                    }
                    const inactiveStyle: React.CSSProperties = {
                      color: '#A0A0A0',
                    }
                    return (
                      <button
                        key={tabKey}
                        onClick={() => {
                          setMobileTxTab(tabKey)
                        }}
                        style={{ ...baseStyle, ...(isActive ? activeStyle : inactiveStyle) }}
                      >
                        {tabKey === 'details' ? t('financeAdmin.transactionDetails') : t('financeAdmin.relatedOrders')}
                        {isActive && (
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: '2px',
                            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                            borderRadius: '1px'
                          }} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <Form
              form={editForm}
              layout="horizontal"
              labelCol={{ span: 8 }}
              wrapperCol={{ span: 16 }}
              className="dark-theme-form"
              style={{
                '--label-color': theme.form.labelColor,
                '--required-mark-color': theme.form.requiredMarkColor
              } as React.CSSProperties}
              onFinish={async (values: any) => {
                setLoading(true)

                try {
                  const income = Number(values.incomeAmount || 0)
                  const expense = Number(values.expenseAmount || 0)

                  if (income <= 0 && expense <= 0) {
                    message.error(t('financeAdmin.enterIncomeOrExpense'))
                    setLoading(false)
                    return
                  }

                  const amount = income - expense
                  // 校验relatedOrders分配总额
                  const ro: Array<{ orderId: string; amount: number }> = Array.isArray(values.relatedOrders) ? values.relatedOrders.filter((r: any) => r?.orderId && Number(r?.amount) > 0).map((r: any) => ({ orderId: String(r.orderId), amount: Number(r.amount) })) : []
                  const roSum = ro.reduce((s, r) => s + r.amount, 0)
                  const absTx = Math.abs(amount)
                  const roSumCents = Math.round(roSum * 100)
                  const absTxCents = Math.round(absTx * 100)

                  if (roSumCents > absTxCents) {
                    message.error(t('financeAdmin.relatedOrdersExceed'))
                    setLoading(false)
                    return
                  }

                  const updated: any = {
                    amount,
                    description: values.description,
                    createdAt: values.transactionDate ? (dayjs(values.transactionDate).toDate()) : new Date()
                  }

                  // 处理 relatedId：有值则设置，无值则删除字段
                  if (values.relatedId) {
                    updated.relatedId = values.relatedId
                  } else {
                    updated.relatedId = null // 明确设置为 null 以删除字段
                  }

                  // 处理 relatedOrders：有订单则设置数组，无订单则删除字段
                  if (ro.length > 0) {
                    updated.relatedOrders = ro
                  } else {
                    updated.relatedOrders = [] // 明确设置为空数组以清空关联
                  }

                  await updateDocument(COLLECTIONS.TRANSACTIONS, viewing.id, updated)

                  // 🔥 核心逻辑：同步更新关联订单的支付时间
                  if (ro.length > 0) {
                    for (const match of ro) {
                      const orderId = match.orderId
                      const txDate = updated.createdAt

                      // 1) 更新订单本人的支付日期和交易 ID 列表
                      const currentOrder = orders.find(o => o.id === orderId)
                      if (currentOrder) {
                        const existingIds = currentOrder.payment?.transactionIds || (currentOrder.payment?.transactionId ? [currentOrder.payment.transactionId] : [])
                        const newIds = Array.from(new Set([...existingIds, viewing.id]))

                        await updateDocument(COLLECTIONS.ORDERS, orderId, {
                          payment: {
                            ...(currentOrder.payment || {}),
                            paidAt: txDate,
                            transactionId: viewing.id, // 保留最后一次关联的 ID 兼容旧逻辑
                            transactionIds: newIds      // 存储所有关联的交易 ID
                          },
                        } as any)

                        // 2) 同步更新出库记录及库存变动的日期（影响利润报表）
                        const outboundOrders = await getOutboundOrdersByReferenceNo(orderId)
                        for (const ob of outboundOrders) {
                          // 更新出库单日期
                          await updateDocument(COLLECTIONS.OUTBOUND_ORDERS, ob.id, {
                            createdAt: txDate,
                            updatedAt: new Date()
                          } as any)

                          // 3) 更新关联的所有 InventoryMovements
                          const qMov = query(
                            collection(db, COLLECTIONS.INVENTORY_MOVEMENTS),
                            where('outboundOrderId', '==', ob.id)
                          )
                          const snapMov = await getDocs(qMov)
                          for (const movDoc of snapMov.docs) {
                            await updateDoc(movDoc.ref, {
                              createdAt: txDate,
                              updatedAt: new Date()
                            })
                          }
                        }
                      }
                    }
                  }

                  message.success(t('financeAdmin.updated'))
                  setIsEditing(false)
                  closeViewing()

                  // 重新加载相关数据以反映变化
                  await refreshData() // 获取最新支付日期的订单，并同步更新交易列表
                } catch (error) {
                  console.error('❌ [Finance] Save error:', error)
                  message.error(t('common.updateFailed'))
                } finally {
                  setLoading(false)
                }
              }}
            >
              <div style={{ display: isMobile ? 'block' : 'flex', gap: 16 }}>
                <div style={{
                  width: isMobile ? '100%' : 360,
                  minWidth: isMobile ? 'auto' : 320,
                  display: isMobile && mobileTxTab !== 'details' ? 'none' : 'block'
                }}>
                  <Form.Item label={t('financeAdmin.transactionDate')} name="transactionDate" rules={[{ required: true, message: t('financeAdmin.selectTransactionDate') }]}>
                    <DatePicker style={{ width: '100%' }} disabled={!isEditing} />
                  </Form.Item>
                  <Form.Item label={t('financeAdmin.income')} name="incomeAmount">
                    <InputNumber style={{ width: '100%' }} min={0} disabled={!isEditing} controls={false} />
                  </Form.Item>
                  <Form.Item label={t('financeAdmin.expense')} name="expenseAmount">
                    <InputNumber style={{ width: '100%' }} min={0} disabled={!isEditing} controls={false} />
                  </Form.Item>
                  <Form.Item label={t('financeAdmin.description')} name="description" rules={[{ required: true, message: t('financeAdmin.enterDescription') }]}>
                    <Input.TextArea rows={3} disabled={!isEditing} />
                  </Form.Item>
                </div>
                <div style={{
                  flex: 1,
                  minWidth: isMobile ? 'auto' : 380,
                  display: isMobile && mobileTxTab !== 'matching' ? 'none' : 'block'
                }}>
                  <Form.List name="relatedOrders">
                    {(fields, { add, remove }) => (
                      <div style={theme.card.base}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong style={{ color: '#FFFFFF' }}>
                            {isExpenseTransaction ? t('financeAdmin.relatedInboundReferences') : t('financeAdmin.relatedOrders')}
                          </strong>
                          {isEditing && (
                            <button type="button" onClick={() => add({ orderId: undefined, amount: 0 })} className="cigar-btn-gradient" style={theme.button.text}>{t('common.add')}</button>
                          )}
                        </div>
                        {fields.length === 0 && (
                          <div style={theme.text.hint}>{t('common.noData')}</div>
                        )}
                        {fields.map((field, index) => {
                          const fieldValue = editForm.getFieldValue(['relatedOrders', field.name, 'orderId'])
                          const fieldAmount = editForm.getFieldValue(['relatedOrders', field.name, 'amount']) || 0

                          // 获取订单/入库单信息用于显示
                          let displayInfo: { id: string; text: string } | null = null
                          if (fieldValue) {
                            if (isExpenseTransaction) {
                              const ref = inboundReferenceOptions.find(r => r.referenceNo === fieldValue)
                              if (ref) {
                                displayInfo = {
                                  id: ref.referenceNo,
                                  text: `📦 ${ref.referenceNo} · ${ref.productCount} ${t('inventory.types')} · RM${ref.totalValue.toFixed(2)}`
                                }
                              }
                            } else {
                              const order = (orders || []).find((o: any) => o.id === fieldValue)
                              if (order) {
                                const u = (users || []).find((x: any) => x.id === order.userId)
                                const name = u?.displayName || u?.email || order.userId
                                const total = Number((order as any)?.total || 0)
                                displayInfo = {
                                  id: order.id,
                                  text: `${order.id} · ${name} · RM${total.toFixed(2)}`
                                }
                              }
                            }
                          }

                          return (
                            <div key={field.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                              <Form.Item name={[field.name, 'orderId']} style={{ marginBottom: 0, flex: 1 }}>
                                {isEditing ? (
                                  <Select
                                    allowClear
                                    showSearch
                                    placeholder={isExpenseTransaction ? t('financeAdmin.selectInboundReference') : t('financeAdmin.relatedOrderId')}
                                    filterOption={(input, option) => {
                                      const searchText = (input || '').toLowerCase()
                                      const searchableText = (option as any)?.searchText || ''
                                      return searchableText.toLowerCase().includes(searchText)
                                    }}
                                    options={isExpenseTransaction ? (
                                      // 支出交易：显示入库单号
                                      inboundReferenceOptions
                                        .filter(ref => !ref.isFullyMatched || ref.referenceNo === fieldValue)
                                        .map(ref => {
                                          const searchText = `${ref.referenceNo} ${ref.reason} ${ref.totalValue.toFixed(2)}`
                                          return {
                                            label: (
                                              <div>
                                                <div>
                                                  📦 {ref.referenceNo} · {ref.productCount} {t('inventory.types')} · RM{ref.totalValue.toFixed(2)}
                                                </div>
                                                <div style={{ fontSize: '12px', color: '#bab09c' }}>
                                                  {ref.reason || '-'}
                                                </div>
                                              </div>
                                            ),
                                            value: ref.referenceNo,
                                            searchText
                                          }
                                        })
                                    ) : (
                                      // 收入交易：显示销售订单
                                      (orders || [])
                                        .filter(o => !isOrderFullyMatched(o.id) || o.id === fieldValue)
                                        .map(o => {
                                          const u = (users || []).find((x: any) => x.id === o.userId)
                                          const name = u?.displayName || u?.email || o.userId
                                          const addr = (o as any)?.shipping?.address || '-'
                                          const total = Number((o as any)?.total || 0)
                                          const searchText = `${o.id} ${name} ${addr} ${total.toFixed(2)}`
                                          return {
                                            label: (
                                              <div>
                                                <div>{o.id} · {name} · RM{total.toFixed(2)}</div>
                                                <div style={{ fontSize: '12px', color: '#bab09c' }}>{addr}</div>
                                              </div>
                                            ),
                                            value: o.id,
                                            searchText
                                          }
                                        })
                                    )}
                                    onChange={(val) => {
                                      const arr = Array.isArray(editForm.getFieldValue('relatedOrders')) ? [...editForm.getFieldValue('relatedOrders')] : []

                                      let defaultAmt = 0
                                      if (isExpenseTransaction) {
                                        // 支出交易：使用入库单的总价值
                                        const inboundRef = inboundReferenceOptions.find(r => r.referenceNo === val)
                                        defaultAmt = inboundRef?.totalValue || 0
                                      } else {
                                        // 收入交易：使用销售订单的总额
                                        const order = (orders || []).find((o: any) => o.id === val)
                                        defaultAmt = Number((order as any)?.total || 0)
                                      }

                                      arr[field.name] = { ...(arr[field.name] || {}), orderId: val, amount: defaultAmt }
                                      editForm.setFieldsValue({ relatedOrders: arr })
                                    }}
                                  />
                                ) : (
                                  <div style={{
                                    padding: '4px 11px',
                                    minHeight: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: '#FFFFFF',
                                    fontSize: 13,
                                    fontWeight: 600
                                  }}>
                                    {displayInfo ? displayInfo.text : fieldValue || '-'}
                                  </div>
                                )}
                              </Form.Item>
                              <Form.Item name={[field.name, 'amount']} style={{ marginBottom: 0, width: 120 }}>
                                <InputNumber min={0} step={0.01} style={{ width: '100%' }} disabled={!isEditing} controls={false} />
                              </Form.Item>
                              {isEditing && (
                                <button type="button" onClick={() => remove(field.name)} style={theme.button.text}>{t('common.remove')}</button>
                              )}
                            </div>
                          )
                        })}
                        <div style={{ ...theme.text.hint, display: 'flex', justifyContent: 'flex-end' }}>
                          {t('financeAdmin.relatedOrdersHint')}
                        </div>
                        {/* 添加统计信息 */}
                        {(() => {
                          const totalMatchedCents = Math.round(totalMatchedAmount * 100)
                          const transactionCents = Math.round(transactionAmount * 100)
                          const exceeded = totalMatchedCents > transactionCents
                          const boxStyle = exceeded ? theme.card.error : theme.card.info
                          const titleStyle = exceeded ? theme.text.error : theme.text.secondary
                          const textStyle = exceeded ? theme.text.error : theme.text.success
                          return (
                            <div style={boxStyle}>
                              <div style={titleStyle}>
                                {t('financeAdmin.relatedOrdersStats')}
                                {exceeded ? ` · ${t('financeAdmin.relatedOrdersExceed')}` : ':'}
                              </div>
                              <div style={textStyle}>
                                <div>{t('financeAdmin.totalMatchedAmount')}: RM{totalMatchedAmount.toFixed(2)}</div>
                                <div>{t('financeAdmin.transactionAmount')}: RM{transactionAmount.toFixed(2)}</div>
                                <div>{t('financeAdmin.remainingAmount')}: RM{remainingAmount.toFixed(2)}</div>
                              </div>
                            </div>
                          )
                        })()}

                        {/* 关联的库存记录 */}
                        {relatedInventoryMovements.length > 0 && (
                          <div style={{
                            marginTop: 16,
                            padding: 12,
                            background: isExpenseTransaction ? 'rgba(82, 196, 26, 0.08)' : 'rgba(255, 77, 79, 0.08)',
                            borderRadius: 8,
                            border: isExpenseTransaction ? '1px solid rgba(82, 196, 26, 0.3)' : '1px solid rgba(255, 77, 79, 0.3)'
                          }}>
                            <div style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: '#fff',
                              marginBottom: 12,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6
                            }}>
                              📦 {isExpenseTransaction ? t('financeAdmin.relatedInboundLogs') : t('financeAdmin.relatedOutboundLogs')}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {(() => {
                                // 按照 referenceNo (订单号/入库单号) 分组
                                const groups: Record<string, any[]> = {}
                                relatedInventoryMovements.forEach(log => {
                                  if (!groups[log.referenceNo]) groups[log.referenceNo] = []
                                  groups[log.referenceNo].push(log)
                                })

                                return Object.entries(groups).map(([refNo, logs]) => {
                                  // 获取该组的公共信息
                                  let customerName = ''
                                  if (!isExpenseTransaction) {
                                    const order = (orders || []).find((o: any) => o.id === refNo)
                                    if (order) {
                                      const customer = (users || []).find((u: any) => u.id === order.userId)
                                      customerName = customer?.displayName || customer?.email || order?.userId || ''
                                    }
                                  }

                                  return (
                                    <div key={refNo}>
                                      {/* 分组头部：订单信息 */}
                                      <div style={{
                                        padding: '4px 11px',
                                        marginBottom: 8,
                                        color: '#F4AF25',
                                        fontSize: 13,
                                        fontWeight: 800,
                                        borderBottom: '1px solid rgba(244, 175, 37, 0.2)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                      }}>
                                        <div>
                                          🔖 {refNo}
                                          {customerName && <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}> · {customerName}</span>}
                                        </div>
                                        <div style={{ color: '#fff', fontSize: 12 }}>
                                          Total: RM {logs.reduce((sum, log) => sum + (Number(log.unitPrice || 0) * log.quantity), 0).toFixed(2)}
                                        </div>
                                      </div>

                                      {/* 商品列表 */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {logs.map((log: any) => {
                                          const cigar = cigars.find(c => c.id === log.cigarId)
                                          const cigarName = log.cigarName || cigar?.name || log.cigarId
                                          const logColor = isExpenseTransaction ? '#52c41a' : '#ff4d4f'
                                          const logPrefix = isExpenseTransaction ? '+' : '-'
                                          const itemTotal = Number(log.unitPrice || 0) * log.quantity

                                          return (
                                            <div key={log.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                              <div style={{
                                                flex: 1,
                                                padding: '4px 11px',
                                                minHeight: '32px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'center',
                                                color: '#FFFFFF',
                                                fontSize: 13,
                                                fontWeight: 600,
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                borderRadius: 4
                                              }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                  <span style={{ fontSize: 12 }}>{cigarName}</span>
                                                  <span style={{ color: logColor }}>{logPrefix}{log.quantity}</span>
                                                </div>
                                              </div>
                                              <div style={{
                                                width: 100,
                                                padding: '4px 11px',
                                                minHeight: '32px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                color: logColor,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                borderRadius: 4
                                              }}>
                                                RM {itemTotal.toFixed(2)}
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })
                              })()}
                            </div>

                            {/* 库存汇总 */}
                            <div style={{
                              marginTop: 12,
                              padding: 8,
                              background: isExpenseTransaction ? 'rgba(82, 196, 26, 0.1)' : 'rgba(255, 77, 79, 0.1)',
                              borderRadius: 6,
                              fontSize: 12,
                              color: '#fff'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <div>
                                  {isExpenseTransaction ? t('financeAdmin.totalInboundItems') : t('financeAdmin.totalOutboundItems')}
                                </div>
                                <div style={{ fontWeight: 600, color: isExpenseTransaction ? '#52c41a' : '#ff4d4f' }}>
                                  {isExpenseTransaction ? '+' : '-'}{relatedInventoryMovements.reduce((sum: number, log: any) => sum + Number(log.quantity || 0), 0)} {t('inventory.sticks')}
                                </div>
                              </div>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: 4,
                                fontSize: 11,
                                color: 'rgba(255,255,255,0.6)'
                              }}>
                                <div>{t('financeAdmin.productTypes')}</div>
                                <div>{relatedInventoryMovements.length} {t('inventory.types')}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Form.List>
                </div>
              </div>
            </Form>
          </>
        )}
      </Modal>

      {/* 添加交易 */}
      <Modal
        title={t('financeAdmin.addTransaction')}
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
        {...getResponsiveModalConfig(isMobile, true, 600)}
      >
        <Form
          form={form}
          layout="vertical"
          className="dark-theme-form"
          onFinish={async (values: any) => {
            setLoading(true)
            try {
              const income = Number(values.incomeAmount || 0)
              const expense = Number(values.expenseAmount || 0)
              if (income <= 0 && expense <= 0) {
                message.error(t('financeAdmin.enterIncomeOrExpense'))
                return
              }
              const amount = income - expense
              const transactionData = {
                type: undefined as any,
                amount,
                currency: undefined,
                description: values.description,
                relatedId: values.relatedId || undefined,
                createdAt: values.transactionDate ? (dayjs(values.transactionDate).toDate()) : new Date()
              }
              const result = await createTransaction(transactionData)
              if (result.success) {
                message.success(t('financeAdmin.transactionAdded'))
                // 重新加载所有交易数据
                await refreshTransactions()
                setCreating(false)
                form.resetFields()
              } else {
                message.error(t('financeAdmin.addFailed'))
              }
            } finally {
              setLoading(false)
            }
          }}>
          <Form.Item label={t('financeAdmin.transactionDate')} name="transactionDate" initialValue={dayjs()} rules={[{ required: true, message: t('financeAdmin.selectTransactionDate') }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('financeAdmin.income')} name="incomeAmount">
            <InputNumber style={{ width: '100%' }} placeholder={t('financeAdmin.enterIncomeAmount')} min={0} controls={false} />
          </Form.Item>
          <Form.Item label={t('financeAdmin.expense')} name="expenseAmount">
            <InputNumber style={{ width: '100%' }} placeholder={t('financeAdmin.enterExpenseAmount')} min={0} controls={false} />
          </Form.Item>
          {/* 移除货币选择 */}
          <Form.Item label={t('financeAdmin.description')} name="description" rules={[{ required: true, message: t('financeAdmin.enterDescription') }]}>
            <Input.TextArea rows={3} placeholder={t('financeAdmin.enterDescription')} />
          </Form.Item>
          <Form.Item label={t('financeAdmin.relatedOrder')} name="relatedId">
            <Select
              allowClear
              showSearch
              placeholder={t('financeAdmin.relatedOrderId')}
              filterOption={(input, option) => {
                const searchText = (input || '').toLowerCase()
                const searchableText = (option as any)?.searchText || ''
                return searchableText.toLowerCase().includes(searchText)
              }}
              options={(orders || []).map(o => {
                const u = (users || []).find((x: any) => x.id === o.userId)
                const name = u?.displayName || u?.email || o.userId
                const addr = (o as any)?.shipping?.address || '-'
                const total = Number((o as any)?.total || 0)
                const searchText = `${o.id} ${name} ${addr} ${total.toFixed(2)}`
                return {
                  label: (
                    <div>
                      <div>{o.id} · {name} · RM{total.toFixed(2)}</div>
                      <div style={{ fontSize: '12px', color: '#bab09c' }}>{addr}</div>
                    </div>
                  ),
                  value: o.id,
                  searchText
                }
              })}
            />
          </Form.Item>
          {/* 移除用户ID输入 */}
        </Form>
      </Modal>

      {/* 粘贴导入交易（表格预览编辑） */}
      <Modal
        title={t('financeAdmin.pasteImportTitle')}
        open={importing}
        onCancel={() => setImporting(false)}
        width={getModalWidth(isMobile, 1000)}
        destroyOnHidden
        centered
        styles={getModalThemeStyles(isMobile, true)}
        onOk={async () => {
          if (!importRows || importRows.length === 0) {
            message.warning(t('financeAdmin.noLinesToImport'))
            return
          }
          setLoading(true)
          let success = 0
          let failed = 0
          for (const r of importRows) {
            const income = Number(r.income ?? 0)
            const expense = Number(r.expense ?? 0)
            if (!isFinite(income) || !isFinite(expense) || (income <= 0 && expense <= 0) || (income > 0 && expense > 0)) {
              failed++
              continue
            }
            // 使用 income - expense 计算金额（与手动创建交易记录的逻辑一致）
            // 收入：income > 0, expense = 0 => amount = income（正数）
            // 支出：income = 0, expense > 0 => amount = -expense（负数）
            const amount = income - expense
            const isIncome = amount > 0
            const parsedDate = dayjs(r.date).isValid() ? dayjs(r.date).toDate() : new Date()
            const payload = {
              type: isIncome ? 'income' : 'expense',
              amount: Number(amount),
              currency: 'MYR',
              description: (r.description || '').trim(),
              createdAt: parsedDate,
            } as any
            const res = await createTransaction(payload)
            if (res.success) success++; else failed++
          }
          setLoading(false)
          message.success(t('financeAdmin.importResult', { success, failed }))
          setImporting(false)

          setImportRows([])
          // 重新加载所有交易数据
          await refreshTransactions()
        }}
        confirmLoading={loading}
      >
        <p style={{ marginBottom: 8 }}>{t('financeAdmin.pasteImportHint')}</p>
        <p style={{ marginTop: 0, color: 'rgba(255, 255, 255, 0.6)' }}>{t('financeAdmin.pasteImportFormat')}</p>
        <div
          onPaste={handlePasteToRows}
          tabIndex={0}
          style={{
            border: '1px dashed rgba(244, 175, 37, 0.6)',
            padding: 12,
            borderRadius: 6,
            marginBottom: 12,
            outline: 'none',
            background: 'rgba(255, 255, 255, 0.05)',
            color: 'rgba(255, 255, 255, 0.6)'
          }}
        >
          {t('financeAdmin.pasteHere')}
        </div>
        <div className="points-config-form">
          <Table
            dataSource={importRows.map((r, idx) => ({ key: idx, date: r.date, description: r.description, income: r.income, expense: r.expense }))}
            size="small"
            pagination={{ pageSize: 5 }}
            style={{
              background: 'transparent'
            }}
            columns={[
              {
                title: t('financeAdmin.transactionDate'),
                dataIndex: 'date',
                key: 'date',
                render: (_: any, record: any, index: number) => (
                  <DatePicker
                    value={dayjs(record.date)}
                    onChange={(d) => {
                      const next = [...importRows]
                      next[index] = { ...next[index], date: (d ? d.toDate() : new Date()) }
                      setImportRows(next)
                    }}
                  />
                )
              },
              {
                title: t('financeAdmin.description'),
                dataIndex: 'description',
                key: 'description',
                render: (v: string, record: any, index: number) => (
                  <Input
                    value={v}
                    onChange={(e) => {
                      const next = [...importRows]
                      next[index] = { ...next[index], description: e.target.value }
                      setImportRows(next)
                    }}
                  />
                )
              },
              {
                title: t('financeAdmin.income'),
                dataIndex: 'income',
                key: 'income',
                width: 120,
                render: (v: number, record: any, index: number) => (
                  <InputNumber
                    min={0}
                    value={v}
                    onChange={(val) => {
                      const next = [...importRows]
                      next[index] = { ...next[index], income: Number(val || 0) }
                      setImportRows(next)
                    }}
                  />
                )
              },
              {
                title: t('financeAdmin.expense'),
                dataIndex: 'expense',
                key: 'expense',
                width: 120,
                render: (v: number, record: any, index: number) => (
                  <InputNumber
                    min={0}
                    value={v}
                    onChange={(val) => {
                      const next = [...importRows]
                      next[index] = { ...next[index], expense: Number(val || 0) }
                      setImportRows(next)
                    }}
                  />
                )
              },
              // 移除用户ID列和相关订单列
              {
                title: t('financeAdmin.actions'),
                key: 'actions',
                width: 90,
                render: (_: any, __: any, index: number) => (
                  <Button danger onClick={() => setImportRows(prev => prev.filter((_, i) => i !== index))}>{t('common.delete')}</Button>
                )
              },
            ]}
          />
        </div>
      </Modal>

      {/* 品牌产品详情弹窗 */}
      <Modal
        title={`${selectedBrand} - ${t('financeAdmin.productSalesDetails')}`}
        open={!!selectedBrand}
        onCancel={() => {
          setSelectedBrand(null)
          setProductExpandedKeys([])
        }}
        footer={null}
        width={getModalWidth(isMobile, 800)}
        destroyOnHidden
        centered
        getContainer={false}
        styles={getModalThemeStyles(isMobile, true)}
      >
        {selectedBrand && (
          <>
            {/* 品牌统计摘要 */}
            <div style={{
              marginBottom: 16,
              padding: isMobile ? 12 : 16,
              background: '#f8f9fa',
              borderRadius: 8,
              border: '1px solid #e9ecef'
            }}>
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600, color: '#495057', marginBottom: 8 }}>
                {t('financeAdmin.brandSummary')}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
                gap: isMobile ? 12 : 24
              }}>
                <div>
                  <div style={{ fontSize: 12, color: '#6c757d' }}>{t('financeAdmin.totalProducts')}</div>
                  <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: '#1890ff' }}>
                    {brandProductDetails.length}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#6c757d' }}>{t('financeAdmin.totalQuantity')}</div>
                  <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: '#1890ff' }}>
                    {brandProductDetails.reduce((sum, p) => sum + p.quantity, 0)} {t('financeAdmin.pieces')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#6c757d' }}>{t('financeAdmin.totalSales')}</div>
                  <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: '#1890ff' }}>
                    RM{brandProductDetails.reduce((sum, p) => sum + p.amount, 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* 产品详情 - 桌面端表格/移动端卡片 */}
            {!isMobile ? (
              <Table
                dataSource={brandProductDetails}
                rowKey={(record, index) => record.cigar?.id || `unknown-${index}`}
                pagination={false}
                size="small"
                expandable={{
                  expandedRowKeys: productExpandedKeys,
                  onExpandedRowsChange: (keys) => setProductExpandedKeys([...keys]),
                  expandedRowRender: (record: any) => (
                    <div style={{ padding: '12px 20px', background: '#fafafa' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#495057', marginBottom: 8 }}>
                        {t('financeAdmin.orderRecords')}
                      </div>
                      <Table
                        dataSource={record.orderDetails}
                        rowKey={(detail: any) => `${detail.orderId}-${detail.orderDate}`}
                        pagination={false}
                        size="small"
                        columns={[
                          {
                            title: t('financeAdmin.orderId'),
                            dataIndex: 'orderId',
                            key: 'orderId',
                            width: 200,
                            render: (id: string) => (
                              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</span>
                            )
                          },
                          {
                            title: t('financeAdmin.orderDate'),
                            dataIndex: 'orderDate',
                            key: 'orderDate',
                            width: 150,
                            render: (date: string) => {
                              if (!date) return '-'
                              const d = dayjs(date)
                              return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '-'
                            }
                          },
                          {
                            title: t('financeAdmin.userName'),
                            dataIndex: 'userName',
                            key: 'userName',
                            width: 150
                          },
                          {
                            title: t('financeAdmin.quantity'),
                            dataIndex: 'quantity',
                            key: 'quantity',
                            width: 100,
                            align: 'right' as const,
                            render: (qty: number) => `${qty} ${t('financeAdmin.pieces')}`
                          },
                          {
                            title: t('financeAdmin.amount'),
                            dataIndex: 'amount',
                            key: 'amount',
                            width: 120,
                            align: 'right' as const,
                            render: (amt: number) => (
                              <span style={{ color: '#1890ff', fontWeight: 600 }}>RM{amt.toFixed(2)}</span>
                            )
                          }
                        ]}
                      />
                    </div>
                  )
                }}
                columns={[
                  {
                    title: t('financeAdmin.productName'),
                    dataIndex: 'cigar',
                    key: 'name',
                    render: (cigar: any, record: any) => (
                      <div>
                        <div style={{ fontWeight: 600, color: '#000000' }}>{cigar?.name || record.cigarId || 'Unknown'}</div>
                        <div style={{ fontSize: 12, color: '#bab09c' }}>{cigar?.specification || '-'}</div>
                      </div>
                    )
                  },
                  {
                    title: t('financeAdmin.salesQuantity'),
                    dataIndex: 'quantity',
                    key: 'quantity',
                    width: 120,
                    align: 'right' as const,
                    render: (quantity: number) => (
                      <span style={{ fontWeight: 600 }}>{quantity} {t('financeAdmin.pieces')}</span>
                    )
                  },
                  {
                    title: t('financeAdmin.salesAmount'),
                    dataIndex: 'amount',
                    key: 'amount',
                    width: 150,
                    align: 'right' as const,
                    render: (amount: number) => (
                      <span style={{ fontWeight: 600, color: '#1890ff' }}>RM{amount.toFixed(2)}</span>
                    )
                  },
                  {
                    title: t('financeAdmin.orderCount'),
                    dataIndex: 'orders',
                    key: 'orders',
                    width: 100,
                    align: 'center' as const,
                    render: (orders: number) => (
                      <span>{orders}</span>
                    )
                  }
                ]}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {brandProductDetails.map((product, index) => {
                  const productId = product.cigar?.id || `unknown-${index}`
                  const isExpanded = productExpandedKeys.includes(productId)
                  return (
                    <div
                      key={productId}
                      style={{
                        background: '#f8f9fa',
                        borderRadius: 8,
                        border: '1px solid #e9ecef',
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{ padding: 12 }}>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#212529' }}>
                            {product.cigar?.name || product.cigarId || 'Unknown'}
                          </div>
                          {product.cigar?.specification && (
                            <div style={{ fontSize: 12, color: '#6c757d', marginTop: 2 }}>
                              {product.cigar.specification}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#6c757d' }}>{t('financeAdmin.salesQuantity')}</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: '#495057' }}>
                              {product.quantity} {t('financeAdmin.pieces')}
                            </div>
                          </div>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#6c757d' }}>{t('financeAdmin.orderCount')}</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: '#495057' }}>
                              {product.orders}
                            </div>
                          </div>
                          <div style={{ flex: 1, textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: '#6c757d' }}>{t('financeAdmin.salesAmount')}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#1890ff' }}>
                              RM{product.amount.toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (isExpanded) {
                              setProductExpandedKeys(prev => prev.filter(k => k !== productId))
                            } else {
                              setProductExpandedKeys(prev => [...prev, productId])
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 12px',
                            background: 'rgba(24, 144, 255, 0.1)',
                            border: '1px solid rgba(24, 144, 255, 0.3)',
                            borderRadius: 4,
                            color: '#1890ff',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4
                          }}
                        >
                          {isExpanded ? '▲' : '▼'} {isExpanded ? t('common.collapse') : t('common.expand')} {t('financeAdmin.orderRecords')}
                        </button>
                      </div>

                      {isExpanded && (
                        <div style={{
                          padding: 12,
                          background: '#fff',
                          borderTop: '1px solid #e9ecef'
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#495057', marginBottom: 8 }}>
                            {t('financeAdmin.orderRecords')}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {product.orderDetails.map((detail: any, idx: number) => (
                              <div
                                key={`${detail.orderId}-${idx}`}
                                style={{
                                  padding: 10,
                                  background: '#f8f9fa',
                                  borderRadius: 6,
                                  border: '1px solid #e9ecef'
                                }}
                              >
                                <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>
                                  {t('financeAdmin.orderId')}
                                </div>
                                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#212529', marginBottom: 6 }}>
                                  {detail.orderId}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 10, color: '#6c757d' }}>{t('financeAdmin.orderDate')}</div>
                                    <div style={{ fontSize: 11, color: '#495057' }}>
                                      {detail.orderDate ? (() => {
                                        const d = dayjs(detail.orderDate)
                                        return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '-'
                                      })() : '-'}
                                    </div>
                                  </div>
                                  <div style={{ flex: 1, textAlign: 'right' }}>
                                    <div style={{ fontSize: 10, color: '#6c757d' }}>{t('financeAdmin.userName')}</div>
                                    <div style={{ fontSize: 11, color: '#495057' }}>
                                      {detail.userName}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <div>
                                    <span style={{ fontSize: 10, color: '#6c757d' }}>{t('financeAdmin.quantity')}: </span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#495057' }}>
                                      {detail.quantity} {t('financeAdmin.pieces')}
                                    </span>
                                  </div>
                                  <div>
                                    <span style={{ fontSize: 10, color: '#6c757d' }}>{t('financeAdmin.amount')}: </span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1890ff' }}>
                                      RM{detail.amount.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* 删除确认 Modal */}
      <Modal
        open={!!deleting}
        title={t('financeAdmin.deleteTransaction')}
        onCancel={() => setDeleting(null)}
        footer={[
          <button key="cancel" type="button" onClick={() => setDeleting(null)} style={theme.button.secondary}>
            {t('common.cancel')}
          </button>,
          <button key="confirm" type="button" onClick={confirmDeleteTransaction} disabled={loading} style={theme.button.danger}>
            {t('common.confirm')}
          </button>
        ]}
        {...getResponsiveModalConfig(isMobile)}
      >
        <p style={{ color: '#FFFFFF' }}>{t('financeAdmin.deleteTransactionConfirm')}</p>
      </Modal>
      <Drawer
        open={viewingOrderOpen}
        onClose={() => closeViewingOrder()}
        width={getModalWidth(isMobile, 820)}
        styles={{
          body: { padding: 0, background: '#1a160d' },
          header: { background: '#1a160d', borderBottom: '1px solid rgba(244,175,37,0.2)' }
        }}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f4af25', fontWeight: 800 }}>{t('financeAdmin.relatedOrders')} - {viewingOrder?.id}</span>
          </div>
        }
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined style={{ color: '#fff' }} />}
            onClick={() => closeViewingOrder()}
          />
        }
      >
        {viewingOrder && (
          <OrderDetails
            order={viewingOrder}
            users={users}
            cigars={cigars}
            transactions={transactions}
            isMobile={isMobile}
            isEditingInView={false}
            onClose={() => closeViewingOrder()}
            onEditToggle={() => { }} // 禁止在此处编辑
            onOrderUpdate={async () => { }} // 静态查看
          />
        )}
      </Drawer>
    </div>
  )
}

export default AdminFinance
