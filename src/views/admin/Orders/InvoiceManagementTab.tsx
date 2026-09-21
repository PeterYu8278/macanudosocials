import React, { useMemo, useState, useCallback, useEffect } from 'react'
import dayjs from 'dayjs'
import { Button, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, App, Popconfirm, Drawer } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import type { AppConfig, Cigar, Order, OrderInvoiceMeta, User, Transaction } from '@/types'
import { useAuthStore } from '@/store/modules/auth'
import { getAppConfig } from '@/services/firebase/appConfig'
import { COLLECTIONS, updateDocument } from '@/services/firebase/firestore'
import { generateInvoicePdfAndDownload, openInvoicePdfPreview } from '@/utils/invoicePdfRenderer'
import { InvoiceA4Render, mapBusinessDataToInvoiceModel } from '@/views/admin/InvoiceTemplate/InvoiceA4Render'
import { getStatusColor, getStatusText, getUserName, getUserPhone } from './helpers'
import { OrderSkeleton } from '../../../components/features/admin/OrderSkeleton'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'

type InvoiceFormValues = {
  invoiceNo: string
  invoiceDate: dayjs.Dayjs
  invoiceToName: string
  invoiceToAddress: string
  invoiceToPhone: string
  terms: string
  yourRef: string
  ourDoNo: string
}

const padLeft = (value: string, len: number) => value.padStart(len, '0')

const guessInvoiceNo = (order: Order, date: Date, orders: Order[]) => {
  let maxNo = 0
  orders.forEach(o => {
    const invNo = (o as any)?.invoice?.invoiceNo
    if (invNo && typeof invNo === 'string') {
      const match = invNo.match(/IV-(\d+)/)
      if (match && match[1]) {
        const num = parseInt(match[1], 10)
        if (num > maxNo) {
          maxNo = num
        }
      }
    }
  })
  const nextNo = maxNo + 1
  return `IV-${String(nextNo).padStart(5, '0')}`
}

const toDateSafe = (val: any): Date => {
  if (!val) return new Date()
  if (val instanceof Date && !isNaN(val.getTime())) return val
  if (typeof val?.toDate === 'function') {
    const d = val.toDate()
    return d instanceof Date && !isNaN(d.getTime()) ? d : new Date()
  }
  const d = new Date(val)
  return isNaN(d.getTime()) ? new Date() : d
}

interface InvoiceManagementTabProps {
  orders: Order[]
  users: User[]
  cigars: Cigar[]
  transactions: Transaction[]
  appConfig: AppConfig | null
  loading: boolean
  isMobile: boolean
  onRefresh: () => Promise<void>
  onViewOrder?: (order: Order) => void
}

export const InvoiceManagementTab: React.FC<InvoiceManagementTabProps> = ({
  orders,
  users,
  cigars,
  transactions,
  appConfig,
  loading,
  isMobile,
  onRefresh,
  onViewOrder,
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

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
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'invoiced' | 'notInvoiced'>('all')
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<InvoiceFormValues>()
  const [latestAppConfig, setLatestAppConfig] = useState<AppConfig | null>(null)

  const [searchText, setSearchText] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [prevSelectedCount, setPrevSelectedCount] = useState(0)
  const [previewValues, setPreviewValues] = useState<InvoiceFormValues | null>(null)

  const groupItems = useCallback((ordersList: Order[]): Order['items'] => {
    if (ordersList.length === 0) return []
    
    const groups = new Map<string, {
      cigarId: string
      price: number
      totalQty: number
      usersList: { userName: string; quantity: number }[]
    }>()

    ordersList.forEach(o => {
      const userName = getUserName(o.userId, users)
      ;(o.items || []).forEach(it => {
        const cigarId = it.cigarId || ''
        const price = Number(it.price || 0)
        const qty = Number(it.quantity || 0)
        const key = `${cigarId}_${price}`
        
        if (!groups.has(key)) {
          groups.set(key, {
            cigarId,
            price,
            totalQty: 0,
            usersList: []
          })
        }
        
        const g = groups.get(key)!
        g.totalQty += qty
        
        const existingUser = g.usersList.find(u => u.userName === userName)
        if (existingUser) {
          existingUser.quantity += qty
        } else {
          g.usersList.push({ userName, quantity: qty })
        }
      })
    })

    return Array.from(groups.values()).map(g => {
      const cigar = cigars.find(c => c.id === g.cigarId)
      const baseName = cigar?.name || g.cigarId
      
      let description = baseName
      if (ordersList.length > 1 && g.usersList.length > 0) {
        const details = g.usersList
          .map(u => `  - ${u.userName}: ${u.quantity} pcs`)
          .join('\n')
        description = `${baseName}\n${details}`
      }

      return {
        cigarId: g.cigarId,
        name: description,
        price: g.price,
        quantity: g.totalQty
      }
    })
  }, [cigars, users])

  const getVirtualOrder = useCallback((ordersList: Order[]): Order => {
    if (ordersList.length === 0) return {} as Order
    const mergedItems = groupItems(ordersList)
    const totalAmount = ordersList.reduce((sum, o) => sum + (o.total || 0), 0)
    return {
      ...ordersList[0],
      id: ordersList.map(o => o.id).join(','),
      orderNo: ordersList.map(o => o.orderNo).join(', '),
      total: totalAmount,
      items: mergedItems,
    }
  }, [groupItems])

  const prepareActiveOrders = useCallback((selected: Order[]) => {
    setActiveOrders(selected)
    const firstOrder = selected[0]
    const inv = (firstOrder as any)?.invoice as OrderInvoiceMeta | undefined
    const defaultDate = inv?.invoiceDate ? dayjs(toDateSafe(inv.invoiceDate)) : dayjs()
    const initialVals = {
      invoiceNo: inv?.invoiceNo || guessInvoiceNo(firstOrder, defaultDate.toDate(), orders),
      invoiceDate: defaultDate,
      invoiceToName: inv?.invoiceTo?.name || getUserName(firstOrder.userId, users),
      invoiceToAddress: inv?.invoiceTo?.address || (firstOrder as any)?.shipping?.address || '',
      invoiceToPhone: inv?.invoiceTo?.phone || getUserPhone(firstOrder.userId, users) || '',
      terms: inv?.terms || 'CASH',
      yourRef: inv?.yourRef || '',
      ourDoNo: inv?.ourDoNo || '',
    }
    form.setFieldsValue(initialVals)
    setPreviewValues(initialVals)
  }, [orders, users, form])

  const resolveAppConfig = async (): Promise<AppConfig | null> => {
    try {
      const cfg = await getAppConfig()
      if (cfg) {
        setLatestAppConfig(cfg)
        return cfg
      }
    } catch {
      // ignore; fall back to prop/state
    }
    return latestAppConfig || appConfig || null
  }

  const enrichOrderItems = useCallback((order: Order): Order => ({
    ...order,
    items: (order.items || []).map(it => {
      const cigar = cigars.find(c => c.id === it.cigarId)
      return { ...it, name: it.name || cigar?.name || it.cigarId }
    }),
  }), [cigars])

  const getMergedOrderForInvoice = useCallback((order: Order, invoiceNo?: string): Order => {
    if (!invoiceNo) return enrichOrderItems(order)
    const sharingOrders = orders.filter(o => (o as any)?.invoice?.invoiceNo === invoiceNo)
    if (sharingOrders.length <= 1) return enrichOrderItems(order)
    return getVirtualOrder(sharingOrders)
  }, [orders, enrichOrderItems, getVirtualOrder])

  const previewInvoicePdf = async (order: Order, inv: OrderInvoiceMeta) => {
    const cfg = await resolveAppConfig()
    const mergedOrder = getMergedOrderForInvoice(order, inv.invoiceNo)
    const ok = openInvoicePdfPreview({
      order: mergedOrder,
      invoice: inv,
      appConfig: cfg,
      filename: `${inv.invoiceNo}.pdf`,
    })
    if (!ok) message.warning(t('ordersAdmin.invoice.previewFailed'))
  }

  const downloadInvoicePdf = async (order: Order, inv: OrderInvoiceMeta) => {
    const cfg = await resolveAppConfig()
    const mergedOrder = getMergedOrderForInvoice(order, inv.invoiceNo)
    await generateInvoicePdfAndDownload({
      order: mergedOrder,
      invoice: inv,
      appConfig: cfg,
      filename: `${inv.invoiceNo}.pdf`,
    })
  }

  const handleRevoke = useCallback(async (record: Order) => {
    try {
      const res = await updateDocument<Order>(COLLECTIONS.ORDERS, record.id, {
        invoice: null as any,
      })
      if (res.success) {
        message.success(t('ordersAdmin.invoice.revokeSuccess'))
        await onRefresh()
      } else {
        message.error(t('ordersAdmin.invoice.revokeFailed'))
      }
    } catch (err) {
      console.error(err)
      message.error(t('ordersAdmin.invoice.revokeFailed'))
    }
  }, [onRefresh, t])

  const filteredOrders = useMemo(() => {
    let result = orders
    if (invoiceFilter === 'invoiced') {
      result = result.filter(o => !!(o as any)?.invoice)
    } else if (invoiceFilter === 'notInvoiced') {
      result = result.filter(o => !(o as any)?.invoice)
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim()
      result = result.filter(o => {
        const idMatch = String(o.id || '').toLowerCase().includes(q)
        const addrMatch = String((o as any)?.shipping?.address || '').toLowerCase().includes(q)

        const userName = getUserName(o.userId, users).toLowerCase()
        const userPhone = (getUserPhone(o.userId, users) || '').toLowerCase()
        const userMatch = userName.includes(q) || userPhone.includes(q)

        const totalStr = Number(o.total || 0).toFixed(2)
        const totalMatch = totalStr.includes(q) || String(o.total || '').includes(q)

        const invoiceNo = (o as any)?.invoice?.invoiceNo
        const invoiceNoMatch = invoiceNo ? String(invoiceNo).toLowerCase().includes(q) : false

        return idMatch || addrMatch || userMatch || totalMatch || invoiceNoMatch
      })
    }
    return result
  }, [orders, invoiceFilter, searchText, users])

  useEffect(() => {
    if (selectedRowKeys.length > 1) {
      const selected = filteredOrders.filter(o => selectedRowKeys.includes(o.id))
      prepareActiveOrders(selected)
      if (selectedRowKeys.length > prevSelectedCount) {
        setDrawerOpen(true)
      }
    } else if (selectedRowKeys.length <= 1) {
      setDrawerOpen(false)
    }
    setPrevSelectedCount(selectedRowKeys.length)
  }, [selectedRowKeys, filteredOrders, prevSelectedCount, prepareActiveOrders])

  const invoicePreviewModel = useMemo(() => {
    if (activeOrders.length === 0 || !previewValues) return null
    const order = getVirtualOrder(activeOrders)
    
    const invoiceMeta: OrderInvoiceMeta = {
      invoiceNo: previewValues.invoiceNo,
      invoiceDate: previewValues.invoiceDate ? (previewValues.invoiceDate.toDate?.() || new Date(previewValues.invoiceDate as any)) : new Date(),
      terms: previewValues.terms || 'CASH',
      yourRef: previewValues.yourRef || '',
      ourDoNo: previewValues.ourDoNo || '',
      invoiceTo: {
        name: previewValues.invoiceToName,
        address: previewValues.invoiceToAddress,
        phone: previewValues.invoiceToPhone,
      },
      generatedAt: new Date(),
      generatedBy: user?.id || '',
    }

    const currencySymbol = appConfig?.invoiceTemplate?.table?.currencySymbol || 'RM'
    
    return mapBusinessDataToInvoiceModel(
      enrichOrderItems(order),
      invoiceMeta,
      appConfig,
      appConfig?.invoiceTemplate || {},
      currencySymbol
    )
  }, [activeOrders, previewValues, appConfig, cigars, enrichOrderItems, getVirtualOrder])

  const columns: ColumnsType<Order> = useMemo(() => [
    {
      title: t('ordersAdmin.orderId'),
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (id: string, record: Order) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div><Button
            type="link"
            style={{
              padding: 0,
              height: 'auto',
              fontFamily: 'monospace',
              fontSize: 11,
              color: '#FDE08D',
              fontWeight: 600,
              textAlign: 'left'
            }}
            onClick={() => onViewOrder?.(record)}
          >
            {id}
          </Button>
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.45)', marginTop: 2, wordBreak: 'break-all', whiteSpace: 'normal' }}>
            {(record as any)?.shipping?.address || '-'}
          </span>
        </div>
      ),
    },
    {
      title: t('ordersAdmin.user'),
      dataIndex: 'userId',
      key: 'userId',
      width: 130,
      render: (userId: string) => (
        <div style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
          <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: 12 }}>{getUserName(userId, users)}</div>
          <div style={{ fontSize: 11, color: '#CCCCCC' }}>{getUserPhone(userId, users) || '-'}</div>
        </div>
      ),
    },
    {
      title: t('ordersAdmin.totalAmount'),
      dataIndex: 'total',
      key: 'total',
      width: 100,
      render: (v: number) => <span style={{ fontWeight: 800, color: '#f4af25', fontSize: 12 }}>RM{Number(v || 0).toFixed(2)}</span>,
    },
    {
      title: t('inventory.paymentStatus'),
      key: 'paymentStatus',
      width: 120,
      render: (_: any, record: Order) => {
        const matchStatus = getOrderMatchStatus(record.id)
        if (matchStatus.status === 'fully') {
          return (
            <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
              {t('financeAdmin.fullyMatched')}
            </Tag>
          )
        } else if (matchStatus.status === 'partial') {
          return (
            <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
              {t('financeAdmin.partialMatched')}: RM{matchStatus.matched.toFixed(2)}
            </Tag>
          )
        } else {
          return (
            <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
              {t('inventory.unpaid')}
            </Tag>
          )
        }
      },
    },
    {
      title: t('ordersAdmin.invoice.status'),
      key: 'invoice',
      width: 130,
      render: (_: any, record: Order) => {
        const inv = (record as any)?.invoice as OrderInvoiceMeta | undefined
        if (!inv) return <Tag style={{ margin: 0, fontSize: 11 }}>{t('ordersAdmin.invoice.notGenerated')}</Tag>
        return (
          <Space size={4} style={{ display: 'flex', flexWrap: 'wrap' }}>
            <Tag color="green" style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>
              {inv.invoiceNo}
            </Tag>
          </Space>
        )
      }
    },
    {
      title: t('ordersAdmin.actions'),
      key: 'actions',
      width: 180,
      render: (_: any, record: Order) => {
        const inv = (record as any)?.invoice as OrderInvoiceMeta | undefined
        const hasInvoice = !!inv

        const handleGenerateEdit = () => {
          setActiveOrders([record])
          const defaultDate = inv?.invoiceDate ? dayjs(toDateSafe(inv.invoiceDate)) : dayjs()
          form.setFieldsValue({
            invoiceNo: inv?.invoiceNo || guessInvoiceNo(record, defaultDate.toDate(), orders),
            invoiceDate: defaultDate,
            invoiceToName: inv?.invoiceTo?.name || getUserName(record.userId, users),
            invoiceToAddress: inv?.invoiceTo?.address || (record as any)?.shipping?.address || '',
            invoiceToPhone: inv?.invoiceTo?.phone || getUserPhone(record.userId, users) || '',
            terms: inv?.terms || 'CASH',
            yourRef: inv?.yourRef || '',
            ourDoNo: inv?.ourDoNo || '',
          })
          setModalOpen(true)
        }

        return (
          <Space size={4}>
            {hasInvoice ? (
              <>
                <Button
                  size="small"
                  type="default"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)',
                    fontSize: 11,
                    padding: '2px 8px'
                  }}
                  onClick={async () => {
                    await previewInvoicePdf(record, inv)
                  }}
                >
                  {t('ordersAdmin.invoice.view')}
                </Button>
                <Button
                  size="small"
                  type="default"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)',
                    fontSize: 11,
                    padding: '2px 8px'
                  }}
                  onClick={async () => {
                    await downloadInvoicePdf(record, inv)
                  }}
                >
                  {t('ordersAdmin.invoice.print')}
                </Button>
                <Button
                  size="small"
                  type="default"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: '#FFD700',
                    border: '1px solid rgba(254,224,141,0.3)',
                    fontSize: 11,
                    padding: '2px 8px'
                  }}
                  onClick={handleGenerateEdit}
                >
                  {t('common.edit')}
                </Button>
                <Popconfirm
                  title={t('ordersAdmin.invoice.revokeConfirm')}
                  onConfirm={() => handleRevoke(record)}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                >
                  <Button
                    size="small"
                    type="default"
                    danger
                    style={{
                      background: 'rgba(255,77,79,0.06)',
                      border: '1px solid rgba(255,77,79,0.3)',
                      fontSize: 11,
                      padding: '2px 8px'
                    }}
                  >
                    {t('ordersAdmin.invoice.revoke')}
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <Button
                size="small"
                type="primary"
                style={{
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700,
                  fontSize: 11,
                  padding: '2px 8px'
                }}
                onClick={handleGenerateEdit}
              >
                {t('ordersAdmin.invoice.generate')}
              </Button>
            )}
          </Space>
        )
      },
    },
  ], [t, users, cigars, appConfig, form, user?.id, onViewOrder, handleRevoke, orders])

  const generateAndPrint = async () => {
    if (activeOrders.length === 0) return
    const values = await form.validateFields()
    const invoiceDate = values.invoiceDate?.toDate?.() ? values.invoiceDate.toDate() : dayjs(values.invoiceDate).toDate()
    const invoice: OrderInvoiceMeta = {
      invoiceNo: values.invoiceNo.trim(),
      invoiceDate,
      invoiceTo: {
        name: values.invoiceToName.trim(),
        address: values.invoiceToAddress.trim(),
        phone: values.invoiceToPhone.trim(),
      },
      terms: values.terms?.trim() || 'CASH',
      yourRef: values.yourRef?.trim() || '',
      ourDoNo: values.ourDoNo?.trim() || '',
      generatedAt: new Date(),
      generatedBy: user?.id || '',
    }

    // Write back to all activeOrders
    const promises = activeOrders.map(order =>
      updateDocument<Order>(COLLECTIONS.ORDERS, order.id, {
        invoice,
      } as any)
    )
    const results = await Promise.all(promises)
    const allSuccessful = results.every(res => res.success)
    if (!allSuccessful) {
      message.error(t('ordersAdmin.invoice.saveFailed'))
      return
    }

    await onRefresh()

    const cfg = await resolveAppConfig()

    // Create a virtual order that merges all activeOrders
    const virtualOrder = getVirtualOrder(activeOrders)

    message.success(t('ordersAdmin.invoice.generatedSuccessfully'))
    setModalOpen(false)
    setActiveOrders([])
    setSelectedRowKeys([])
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        marginBottom: 10,
        padding: isMobile ? '0' : '16px',
        background: isMobile ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        border: isMobile ? 'none' : '1px solid rgba(244, 175, 37, 0.6)',
        backdropFilter: isMobile ? 'none' : 'blur(10px)',
        flexShrink: 0
      }}>
        {!isMobile ? (
          <Space size="middle">
            <Input
              placeholder={t('ordersAdmin.searchPlaceholder')}
              allowClear
              style={{ width: 220 }}
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="points-config-form"
            />
            <Select
              value={invoiceFilter}
              onChange={setInvoiceFilter}
              style={{ width: 180 }}
              className="points-config-form"
              options={[
                { value: 'all', label: t('ordersAdmin.invoice.filterAll') },
                { value: 'invoiced', label: t('ordersAdmin.invoice.filterInvoiced') },
                { value: 'notInvoiced', label: t('ordersAdmin.invoice.filterNotInvoiced') },
              ]}
            />
            <Button
              disabled={selectedRowKeys.length === 0}
              className="points-config-form"
              style={{
                background: selectedRowKeys.length >= 1 ? 'linear-gradient(to right,#FDE08D,#C48D3A)' : 'rgba(255,255,255,0.1)',
                border: 'none',
                color: selectedRowKeys.length >= 1 ? '#111' : 'rgba(255,255,255,0.3)',
                fontWeight: 700
              }}
              onClick={() => {
                if (selectedRowKeys.length === 0) {
                  message.info(t('ordersAdmin.invoice.selectOneOrder'))
                  return
                }
                const selected = filteredOrders.filter(o => selectedRowKeys.includes(o.id))
                if (selected.length === 0) return
                setActiveOrders(selected)
                const firstOrder = selected[0]
                const inv = (firstOrder as any)?.invoice as OrderInvoiceMeta | undefined
                const defaultDate = inv?.invoiceDate ? dayjs(toDateSafe(inv.invoiceDate)) : dayjs()
                form.setFieldsValue({
                  invoiceNo: inv?.invoiceNo || guessInvoiceNo(firstOrder, defaultDate.toDate(), orders),
                  invoiceDate: defaultDate,
                  invoiceToName: inv?.invoiceTo?.name || getUserName(firstOrder.userId, users),
                  invoiceToAddress: inv?.invoiceTo?.address || (firstOrder as any)?.shipping?.address || '',
                  invoiceToPhone: inv?.invoiceTo?.phone || getUserPhone(firstOrder.userId, users) || '',
                  terms: inv?.terms || 'CASH',
                  yourRef: inv?.yourRef || '',
                  ourDoNo: inv?.ourDoNo || '',
                })
                setModalOpen(true)
              }}
            >
              {selectedRowKeys.length <= 1 ? t('ordersAdmin.invoice.generate') : `${t('ordersAdmin.invoice.generate')} (${selectedRowKeys.length})`}
            </Button>
          </Space>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder={t('ordersAdmin.searchPlaceholder')}
              allowClear
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="points-config-form"
            />
            <Select
              value={invoiceFilter}
              onChange={setInvoiceFilter}
              style={{ width: '100%' }}
              className="points-config-form"
              options={[
                { value: 'all', label: t('ordersAdmin.invoice.filterAll') },
                { value: 'invoiced', label: t('ordersAdmin.invoice.filterInvoiced') },
                { value: 'notInvoiced', label: t('ordersAdmin.invoice.filterNotInvoiced') },
              ]}
            />
            {selectedRowKeys.length >= 1 && (
              <Button
                block
                className="points-config-form"
                style={{
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700
                }}
                onClick={() => {
                  const selected = filteredOrders.filter(o => selectedRowKeys.includes(o.id))
                  if (selected.length === 0) return
                  setActiveOrders(selected)
                  const firstOrder = selected[0]
                  const inv = (firstOrder as any)?.invoice as OrderInvoiceMeta | undefined
                  const defaultDate = inv?.invoiceDate ? dayjs(toDateSafe(inv.invoiceDate)) : dayjs()
                  form.setFieldsValue({
                    invoiceNo: inv?.invoiceNo || guessInvoiceNo(firstOrder, defaultDate.toDate(), orders),
                    invoiceDate: defaultDate,
                    invoiceToName: inv?.invoiceTo?.name || getUserName(firstOrder.userId, users),
                    invoiceToAddress: inv?.invoiceTo?.address || (firstOrder as any)?.shipping?.address || '',
                    invoiceToPhone: inv?.invoiceTo?.phone || getUserPhone(firstOrder.userId, users) || '',
                    terms: inv?.terms || 'CASH',
                    yourRef: inv?.yourRef || '',
                    ourDoNo: inv?.ourDoNo || '',
                  })
                  setModalOpen(true)
                }}
              >
                {selectedRowKeys.length === 1 ? t('ordersAdmin.invoice.generateSelected') : `${t('ordersAdmin.invoice.generate')} (${selectedRowKeys.length})`}
              </Button>
            )}
          </div>
        )}
      </div>

      {!isMobile ? (
        <div className="points-config-form">
          {loading ? (
            <OrderSkeleton isMobile={false} />
          ) : (
            <Table
              columns={columns}
              dataSource={filteredOrders}
              rowKey="id"
              loading={loading}
              rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 50 }}
              virtual={filteredOrders.length > 50}
              pagination={{ pageSize: 20 }}
              scroll={{ x: 'max-content', y: 'calc(100vh - 400px)' }}
              style={{
                background: 'transparent',
                borderRadius: 12,
                border: '1px solid rgba(244, 175, 37, 0.2)',
                overflow: 'hidden'
              }}
            />
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1, paddingBottom: 16 }}>
          {loading ? (
            <OrderSkeleton isMobile={true} />
          ) : (
            <>
              {filteredOrders.map(record => {
                const inv = (record as any)?.invoice as OrderInvoiceMeta | undefined
                return (
                  <div key={record.id} style={{
                    border: '1px solid rgba(244,175,37,0.2)',
                    borderRadius: 12,
                    padding: 12,
                    background: 'rgba(34,28,16,0.5)',
                    backdropFilter: 'blur(10px)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Button
                        type="link"
                        style={{
                          padding: 0,
                          height: 'auto',
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: '#FDE08D',
                          fontWeight: 600,
                          textAlign: 'left'
                        }}
                        onClick={() => onViewOrder?.(record)}
                      >
                        {record.id.substring(0, 30)}
                      </Button>
                      <Tag color={getStatusColor(record.status)} style={{ margin: 0 }}>
                        {getStatusText(record.status, t)}
                      </Tag>
                    </div>

                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>{getUserName(record.userId, users)}</div>
                      <div style={{ fontSize: 11, color: '#CCCCCC' }}>{getUserPhone(record.userId, users) || '-'}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#f4af25' }}>RM{Number(record.total || 0).toFixed(2)}</div>
                      {inv ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Tag color="green" style={{ margin: 0, fontFamily: 'monospace', fontWeight: 600 }}>{inv.invoiceNo}</Tag>
                        </div>
                      ) : (
                        <Tag style={{ margin: 0 }}>{t('ordersAdmin.invoice.notGenerated')}</Tag>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          style={{
                            flex: 1,
                            height: 36,
                            background: 'rgba(255,255,255,0.1)',
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                          onClick={async () => {
                            if (!inv) { message.info(t('ordersAdmin.invoice.needGenerateFirst')); return }
                            await previewInvoicePdf(record, inv)
                          }}
                        >
                          {t('ordersAdmin.invoice.view')}
                        </Button>
                        <Button
                          style={{
                            flex: 1,
                            height: 36,
                            background: 'rgba(255,255,255,0.1)',
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                          onClick={async () => {
                            if (!inv) { message.info(t('ordersAdmin.invoice.needGenerateFirst')); return }
                            await downloadInvoicePdf(record, inv)
                          }}
                        >
                          {t('ordersAdmin.invoice.print')}
                        </Button>
                        {inv && (
                          <Popconfirm
                            title={t('ordersAdmin.invoice.revokeConfirm')}
                            onConfirm={() => handleRevoke(record)}
                            okText={t('common.yes')}
                            cancelText={t('common.no')}
                          >
                            <Button
                              danger
                              style={{
                                flex: 1,
                                height: 36,
                                background: 'rgba(255,77,79,0.15)',
                                border: '1px solid rgba(255,77,79,0.3)',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600
                              }}
                            >
                              {t('ordersAdmin.invoice.revoke')}
                            </Button>
                          </Popconfirm>
                        )}
                      </div>
                      <Button
                        type="primary"
                        style={{
                          width: '100%',
                          height: 42,
                          background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                          border: 'none',
                          color: '#111',
                          fontWeight: 700,
                          borderRadius: 8,
                          fontSize: 14,
                          boxShadow: '0 4px 12px rgba(196, 141, 58, 0.2)'
                        }}
                        onClick={() => {
                          setActiveOrders([record])
                          const defaultDate = inv?.invoiceDate ? dayjs(toDateSafe(inv.invoiceDate)) : dayjs()
                          form.setFieldsValue({
                            invoiceNo: inv?.invoiceNo || guessInvoiceNo(record, defaultDate.toDate(), orders),
                            invoiceDate: defaultDate,
                            invoiceToName: inv?.invoiceTo?.name || getUserName(record.userId, users),
                            invoiceToAddress: inv?.invoiceTo?.address || (record as any)?.shipping?.address || '',
                            invoiceToPhone: inv?.invoiceTo?.phone || getUserPhone(record.userId, users) || '',
                            terms: inv?.terms || 'CASH',
                            yourRef: inv?.yourRef || '',
                            ourDoNo: inv?.ourDoNo || '',
                          })
                          setModalOpen(true)
                        }}
                      >
                        {t('ordersAdmin.invoice.generate')}
                      </Button>
                    </div>
                  </div>
                )
              })}
              {filteredOrders.length === 0 && (
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>{t('common.noData')}</div>
              )}
            </>
          )}
        </div>
      )}

      <Modal
        title={t('ordersAdmin.invoice.modalTitle')}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          setActiveOrders([])
        }}
        onOk={generateAndPrint}
        okText={t('ordersAdmin.invoice.generate')}
        cancelText={t('common.cancel')}
        width={isMobile ? '100%' : 600}
        style={{ top: isMobile ? 0 : 100 }}
        styles={{
          mask: {
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          },
          content: {
            background: isMobile ? 'linear-gradient(180deg, #221c10 0%, #181611 100%)' : '#1a1a1a',
            color: '#fff',
            border: isMobile ? 'none' : '1px solid rgba(244,175,37,0.3)',
            borderRadius: isMobile ? 0 : 12,
            height: isMobile ? '100vh' : 'auto',
            padding: isMobile ? '12px' : '24px'
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
          },
          body: {
            background: 'transparent'
          },
          footer: {
            background: 'transparent',
            borderTop: '1px solid rgba(244, 175, 37, 0.6)'
          }
        }}
      >
        <div style={{ marginBottom: 16, fontSize: 13, color: 'rgba(255, 255, 255, 0.6)' }}>
          {t('ordersAdmin.invoice.printHint')}
        </div>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 8, xs: 8 }}
          wrapperCol={{ span: 16, xs: 16 }}
          labelAlign="left"
        >
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceNo')}</span>}
            name="invoiceNo"
            rules={[
              { required: true, message: t('ordersAdmin.invoice.invoiceNoRequired') },
              {
                validator: async (_, value) => {
                  const val = String(value || '').trim()
                  if (!val) return
                  const activeOrderIds = new Set(activeOrders.map(o => o.id))
                  const exists = orders.some(o => {
                    if (activeOrderIds.has(o.id)) return false
                    return (o as any)?.invoice?.invoiceNo === val
                  })
                  if (exists) {
                    throw new Error(t('ordersAdmin.invoice.duplicateInvoiceNo') || 'Invoice number already exists!')
                  }
                }
              }
            ]}
          >
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceDate')}</span>}
            name="invoiceDate"
            rules={[{ required: true, message: t('ordersAdmin.invoice.invoiceDateRequired') }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" className="points-config-form" />
          </Form.Item>
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceTo')}</span>}
            name="invoiceToName"
            rules={[{ required: true, message: t('ordersAdmin.invoice.invoiceToRequired') }]}
          >
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.phone')}</span>}
            name="invoiceToPhone"
            rules={[{ required: true, message: t('ordersAdmin.invoice.phoneRequired') }]}
          >
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.terms')}</span>}
            name="terms"
            rules={[{ required: true, message: t('ordersAdmin.invoice.termsRequired') }]}
          >
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item label={<span style={{ color: '#fff' }}>Your Ref.</span>} name="yourRef">
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item label={<span style={{ color: '#fff' }}>Our D/O No</span>} name="ourDoNo">
            <Input className="points-config-form" />
          </Form.Item>
          <Form.Item
            label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.address')}</span>}
            name="invoiceToAddress"
            rules={[{ required: true, message: t('ordersAdmin.invoice.addressRequired') }]}
            layout="vertical"
            labelCol={{ span: 24 }}
            wrapperCol={{ span: 24 }}
          >
            <Input.TextArea rows={3} className="points-config-form" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ color: '#f4af25', fontWeight: 800, fontSize: 16 }}>
              {t('ordersAdmin.invoice.previewTitle') || 'Invoice Preview & Generation'}
            </span>
          </div>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 1150}
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined style={{ color: '#fff' }} />}
            onClick={() => setDrawerOpen(false)}
          />
        }
        styles={{
          body: { padding: 0, background: '#110e08', overflowX: 'hidden' },
          header: { background: '#110e08', borderBottom: '1px solid rgba(244,175,37,0.2)' }
        }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '12px 24px', background: '#110e08', borderTop: '1px solid rgba(244,175,37,0.2)' }}>
            <Button onClick={() => setDrawerOpen(false)} style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', border: 'none', color: '#111', fontWeight: 700 }}
              onClick={generateAndPrint}
            >
              {t('ordersAdmin.invoice.generate')}
            </Button>
          </div>
        }
      >
        {activeOrders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100%', minHeight: 'calc(100vh - 110px)' }}>
            {/* Form Column */}
            <div style={{
              width: isMobile ? '100%' : '380px',
              borderRight: isMobile ? 'none' : '1px solid rgba(244,175,37,0.2)',
              borderBottom: isMobile ? '1px solid rgba(244,175,37,0.2)' : 'none',
              padding: '24px',
              overflowY: 'auto'
            }}>
              <Form
                form={form}
                layout="vertical"
                onValuesChange={(_, allValues) => {
                  setPreviewValues(allValues as any)
                }}
              >
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceNo')}</span>}
                  name="invoiceNo"
                  rules={[
                    { required: true, message: t('ordersAdmin.invoice.invoiceNoRequired') },
                    {
                      validator: async (_, value) => {
                        const val = String(value || '').trim()
                        if (!val) return
                        const activeOrderIds = new Set(activeOrders.map(o => o.id))
                        const exists = orders.some(o => {
                          if (activeOrderIds.has(o.id)) return false
                          return (o as any)?.invoice?.invoiceNo === val
                        })
                        if (exists) {
                          throw new Error(t('ordersAdmin.invoice.duplicateInvoiceNo') || 'Invoice number already exists!')
                        }
                      }
                    }
                  ]}
                >
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceDate')}</span>}
                  name="invoiceDate"
                  rules={[{ required: true, message: t('ordersAdmin.invoice.invoiceDateRequired') }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" className="points-config-form" />
                </Form.Item>
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.invoiceTo')}</span>}
                  name="invoiceToName"
                  rules={[{ required: true, message: t('ordersAdmin.invoice.invoiceToRequired') }]}
                >
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.phone')}</span>}
                  name="invoiceToPhone"
                  rules={[{ required: true, message: t('ordersAdmin.invoice.phoneRequired') }]}
                >
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.terms')}</span>}
                  name="terms"
                  rules={[{ required: true, message: t('ordersAdmin.invoice.termsRequired') }]}
                >
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item label={<span style={{ color: '#fff' }}>Your Ref.</span>} name="yourRef">
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item label={<span style={{ color: '#fff' }}>Our D/O No</span>} name="ourDoNo">
                  <Input className="points-config-form" />
                </Form.Item>
                <Form.Item
                  label={<span style={{ color: '#fff' }}>{t('ordersAdmin.invoice.address')}</span>}
                  name="invoiceToAddress"
                  rules={[{ required: true, message: t('ordersAdmin.invoice.addressRequired') }]}
                >
                  <Input.TextArea rows={3} className="points-config-form" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }} />
                </Form.Item>
              </Form>
            </div>
            
            {/* Preview Column */}
            <div style={{
              flex: 1,
              background: '#0a0905',
              padding: '40px 24px',
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start'
            }}>
              {invoicePreviewModel ? (
                <div style={{
                  boxShadow: '0 15px 40px rgba(0,0,0,0.6)',
                  transform: isMobile ? 'scale(0.45)' : 'scale(0.65)',
                  transformOrigin: 'top center',
                }}>
                  <InvoiceA4Render preview={invoicePreviewModel} />
                </div>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: 40 }}>
                  Loading Preview...
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default InvoiceManagementTab


