// 订单管理页面
import React, { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Table, Space, Input, Select, DatePicker, message, Modal, Tabs, Button, Drawer } from 'antd'
import { SearchOutlined, CheckOutlined, ClockCircleOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons'
import BatchDeleteButton from '../../../components/common/BatchDeleteButton'
import CreateButton from '../../../components/common/CreateButton'
import OrderDetails from './OrderDetails'
import CreateOrderForm from './CreateOrderForm'
import { getOrderColumns } from './useOrderColumns'
import InvoiceManagementTab from './InvoiceManagementTab'
import type { Order, User, Cigar, Transaction, OutboundOrder, InventoryMovement, AppConfig } from '../../../types'
import { getAllOrders, getUsers, getCigars, updateDocument, deleteDocument, COLLECTIONS, getAllTransactions, getAllOutboundOrders, getAllInventoryMovements, deleteOutboundOrder } from '../../../services/firebase/firestore'
import { db } from '../../../config/firebase'
import { collection, query as firestoreQuery, where, getDocs, limit as firestoreLimit, orderBy as firestoreOrderBy } from 'firebase/firestore'
import { getOrdersPaginated } from '../../../services/firebase/paginatedQueries'
import { usePaginatedData } from '../../../hooks/usePaginatedData'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { useTranslation } from 'react-i18next'
import { filterOrders, sortOrders, getStatusColor, getStatusText, getUserName, getUserPhone } from './helpers'
import { getModalThemeStyles, getModalWidth, getResponsiveModalConfig } from '../../../config/modalTheme'
import { getAppConfig } from '../../../services/firebase/appConfig'
import { useAuthStore } from '../../../store/modules/auth'
import { refundOrderPoints, deleteOrderWithRefund } from '../../../services/firebase/orders'
import { OrderSkeleton, StatsSkeleton } from '../../../components/features/admin/OrderSkeleton'

const { Search } = Input
const { Option } = Select

const AdminOrders: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { isSuperAdmin, user: authUser } = useAuthStore()
  const [mainTab, setMainTab] = useState<'orders' | 'invoices'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const {
    data: paginatedOrders,
    loading: paginatedLoading,
    hasMore,
    currentPage,
    loadPage,
    refresh: refreshPaginated
  } = usePaginatedData(
    async (pageSize, lastDoc, filters) => {
      const storeId = isSuperAdmin ? undefined : authUser?.storeId
      const result = await getOrdersPaginated(pageSize, lastDoc, { ...filters, storeId })
      return result
    },
    {
      pageSize: 20,
      mobilePageSize: 10,
      initialLoad: false
    }
  )

  const { item: viewing, open: drawerOpen, openDrawer, closeDrawer } = useDetailDrawer<Order>()
  const [isEditingInView, setIsEditingInView] = useState(false)
  const { data: users = [] } = useFirestoreQuery<User>(() => getUsers({ limit: 500 }))
  const { data: cigars = [] } = useFirestoreQuery<Cigar>(getCigars)
  const { data: transactions = [] } = useFirestoreQuery<Transaction>(
    () => {
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      return getAllTransactions(isSuperAdmin ? undefined : authUser?.storeId, { startDate: ninetyDaysAgo, limit: 1000 })
    },
    [isSuperAdmin, authUser?.storeId]
  )
  const [creating, setCreating] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [paymentFilter, setPaymentFilter] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
  const [matchStatusTab, setMatchStatusTab] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [sortDesc, setSortDesc] = useState<boolean>(true)
  const [pagination, setPagination] = useState(() => {
    const saved = localStorage.getItem('orders-pagination')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        return { current: 1, pageSize: 10, total: 0 }
      }
    }
    return { current: 1, pageSize: 10, total: 0 }
  })

  useEffect(() => {
    loadAppConfig()
    const filters: any = {}
    if (statusFilter) filters.status = statusFilter
    if (paymentFilter) filters.paymentMethod = paymentFilter
    if (dateRange && dateRange[0] && dateRange[1]) {
      filters.startDate = dateRange[0].toDate()
      filters.endDate = dateRange[1].toDate()
    }
    if (!isSuperAdmin && authUser?.storeId) filters.storeId = authUser.storeId
    loadPage(1, Object.keys(filters).length > 0 ? filters : undefined)
  }, [])

  const loadAppConfig = async () => {
    try {
      const config = await getAppConfig()
      if (config) setAppConfig(config)
    } catch (error) {
      console.error('加载应用配置失败:', error)
    }
  }

  useEffect(() => {
    const filters: any = {}
    if (statusFilter) filters.status = statusFilter
    if (paymentFilter) filters.paymentMethod = paymentFilter
    if (dateRange && dateRange[0] && dateRange[1]) {
      filters.startDate = dateRange[0].toDate()
      filters.endDate = dateRange[1].toDate()
    }
    if (!isSuperAdmin && authUser?.storeId) filters.storeId = authUser.storeId
    loadPage(1, Object.keys(filters).length > 0 ? filters : undefined)
  }, [statusFilter, paymentFilter, dateRange, isSuperAdmin, authUser?.storeId])

  useEffect(() => {
    const hasFilters = statusFilter || paymentFilter || (dateRange && dateRange[0] && dateRange[1])
    if (!hasFilters) {
      setLoading(true)
      const opts: { limit: number; startDate?: Date; endDate?: Date } = { limit: 500 }
      if (dateRange && dateRange[0] && dateRange[1]) {
        opts.startDate = dateRange[0].toDate()
        opts.endDate = dateRange[1].toDate()
      }
      getAllOrders(isSuperAdmin ? undefined : authUser?.storeId, opts)
        .then(setOrders)
        .catch(() => message.error(t('messages.dataLoadFailed')))
        .finally(() => setLoading(false))
    } else {
      setOrders(paginatedOrders)
    }
  }, [paginatedOrders, statusFilter, paymentFilter, dateRange, isSuperAdmin, authUser?.storeId, t])

  // 分页处理函数
  const handlePaginationChange = async (page: number, pageSize?: number) => {
    const hasFilters = statusFilter || paymentFilter || (dateRange && dateRange[0] && dateRange[1])

    const newPagination = {
      current: page,
      pageSize: pageSize || pagination.pageSize,
      total: filteredSorted.length
    }
    setPagination(newPagination)
    localStorage.setItem('orders-pagination', JSON.stringify(newPagination))

    // 如果有筛选条件但没有搜索关键词，需要加载服务端分页数据
    if (hasFilters && !keyword.trim()) {
      const filters: any = {}
      if (statusFilter) filters.status = statusFilter
      if (paymentFilter) filters.paymentMethod = paymentFilter
      if (dateRange && dateRange[0] && dateRange[1]) {
        filters.startDate = dateRange[0].toDate()
        filters.endDate = dateRange[1].toDate()
      }
      await loadPage(page, Object.keys(filters).length > 0 ? filters : undefined)
    }
  }

  const refreshAllOrders = async () => {
    await refreshPaginated()
    try {
      const ordersData = await getAllOrders(isSuperAdmin ? undefined : authUser?.storeId)
      setOrders(ordersData)
    } catch {
      // 静默失败：不阻塞 UI
    }
    // Also refresh app_config so invoice previews use the latest invoiceTemplate.
    await loadAppConfig()
  }

  const deleteOrderOutboundRecords = async (orderId: string) => {
    try {
      const q = firestoreQuery(
        collection(db, 'outbound_orders'),
        where('referenceNo', '==', orderId)
      )
      const snap = await getDocs(q)
      if (!snap.empty) {
        await Promise.all(snap.docs.map((d) => deleteOutboundOrder(d.id)))
      }
    } catch (error) {
      console.error('❌ [Orders] Error deleting outbound records:', error)
    }
  }

  const deleteOrderFromEventAllocations = async (orderId: string) => {
    try {
      const eventsSnap = await getDocs(
        firestoreQuery(
          collection(db, 'events'),
          firestoreOrderBy('schedule.startDate', 'desc'),
          firestoreLimit(200)
        )
      )
      const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      for (const event of events) {
        const allocations = (event as any)?.allocations
        if (allocations) {
          let hasChanges = false
          const updatedAllocations = { ...allocations }
          for (const [userId, allocation] of Object.entries(allocations)) {
            if ((allocation as any)?.orderId === orderId) {
              updatedAllocations[userId] = { ...(allocation as any), orderId: undefined }
              hasChanges = true
            }
          }
          if (hasChanges) await updateDocument(COLLECTIONS.EVENTS, event.id, { allocations: updatedAllocations } as any)
        }
      }
    } catch (error) {}
  }

  // 批量删除：在同一次更新中清理多个订单ID对应的分配记录，避免并发覆盖
  const deleteOrdersFromEventAllocations = async (orderIds: string[]) => {
    try {
      if (!orderIds || orderIds.length === 0) return
      const orderIdSet = new Set(orderIds.map(String))
      const eventsSnap = await getDocs(
        firestoreQuery(
          collection(db, 'events'),
          firestoreOrderBy('schedule.startDate', 'desc'),
          firestoreLimit(200)
        )
      )
      const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      for (const event of events) {
        const allocations = (event as any)?.allocations
        if (!allocations) continue

        let hasChanges = false
        const updatedAllocations: Record<string, any> = { ...allocations }

        for (const [userId, allocation] of Object.entries(allocations)) {
          const allocOrderId = (allocation as any)?.orderId
          if (allocOrderId && orderIdSet.has(String(allocOrderId))) {
            updatedAllocations[userId] = {
              ...(allocation as any),
              orderId: undefined,
            }
            hasChanges = true
          }
        }

        if (hasChanges) {
          await updateDocument(COLLECTIONS.EVENTS, (event as any).id, {
            allocations: updatedAllocations,
          } as any)
        }
      }
    } catch (error) {
    }
  }

  const getOrderMatchStatus = (orderId: string) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return { matched: 0, total: 0, status: 'none' }
    const orderTotal = Number(order.total || 0)
    const matchedAmount = transactions
      .filter(t => (t as any)?.relatedOrders?.some((ro: any) => ro.orderId === orderId))
      .reduce((sum, t) => {
        const orderMatch = (t as any)?.relatedOrders?.find((ro: any) => ro.orderId === orderId)
        return sum + (orderMatch ? Number(orderMatch.amount || 0) : 0)
      }, 0)

    if (matchedAmount >= orderTotal) return { matched: matchedAmount, total: orderTotal, status: 'fully' }
    if (matchedAmount > 0) return { matched: matchedAmount, total: orderTotal, status: 'partial' }
    return { matched: matchedAmount, total: orderTotal, status: 'none' }
  }

  const getCigarName = (cigarId: string) => {
    const cigar = cigars.find(c => c.id === cigarId)
    return cigar ? cigar.name : cigarId
  }

  const filtered = useMemo(() => {
    let dataSource = (keyword.trim() || !(statusFilter || paymentFilter || (dateRange && dateRange[0] && dateRange[1]))) ? orders : paginatedOrders
    if (keyword.trim()) dataSource = filterOrders(dataSource, users, keyword, undefined, undefined, undefined, cigars)
    if (matchStatusTab === 'matched') dataSource = dataSource.filter(o => getOrderMatchStatus(o.id).status === 'fully')
    else if (matchStatusTab === 'unmatched') dataSource = dataSource.filter(o => getOrderMatchStatus(o.id).status !== 'fully')
    return dataSource
  }, [orders, paginatedOrders, users, keyword, cigars, matchStatusTab, statusFilter, paymentFilter, dateRange])

  const filteredSorted = useMemo(() => {
    return sortOrders(filtered, sortDesc)
  }, [filtered, sortDesc])

  const handleViewOrder = React.useCallback((order: Order) => {
    openDrawer(order);
    setIsEditingInView(false);
  }, [openDrawer]);

  const handleDeleteOrder = React.useCallback(async (id: string) => {
    // 先退还积分并清理记录（如果是积分支付的订单）
    await deleteOrderWithRefund(id)
    await deleteOrderFromEventAllocations(id)
    await deleteOrderOutboundRecords(id)
    return await deleteDocument(COLLECTIONS.ORDERS, id)
  }, [authUser?.storeId, isSuperAdmin]);

  const handleOrderUpdate = React.useCallback(async () => {
    await refreshPaginated()
  }, [refreshPaginated]);

  const columns = useMemo(() => getOrderColumns({
    users,
    cigars,
    transactions,
    orders,
    onViewOrder: handleViewOrder,
    onDeleteOrder: handleDeleteOrder,
    onOrderUpdate: handleOrderUpdate,
    t,
    i18n
  }), [users, cigars, transactions, orders, handleViewOrder, handleDeleteOrder, handleOrderUpdate, t, i18n.language]);

  return (
    <div
      style={{
        height: isMobile ? '90vh' : 'calc(100vh - 100px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <style>{`
        .orders-management-tabs {
          display: flex;
          flex-direction: column;
        }
        .orders-management-tabs .ant-tabs-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .orders-management-tabs .ant-tabs-tabpane-active {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
        .orders-management-tabs .ant-tabs-content-holder {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
      `}</style>


      <Tabs
        activeKey={mainTab}
        className="orders-management-tabs"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onChange={(k) => {
          setMainTab(k as any)
          if (k === 'invoices') {
            // Ensure invoice previews reflect the latest A4 designer settings without a full page reload.
            void loadAppConfig()
          }
        }}
        items={[
          {
            key: 'orders',
            label: t('ordersAdmin.tabs.orders'),
            children: (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* 置顶筛选区开始 */}
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    background: 'transparent',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)'
                  }}
                >
                  {/* 搜索和筛选 */}
                  {(() => {
                    const matchedCount = orders.filter(o => getOrderMatchStatus(o.id).status === 'fully').length
                    const unmatchedCount = orders.length - matchedCount

                    return !isMobile ? (
                      <div style={{
                        marginBottom: 10,
                        padding: '16px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: 12,
                        border: '1px solid rgba(244, 175, 37, 0.6)',
                        backdropFilter: 'blur(10px)'
                      }}>
                        <Space size={8}>
                          <Search
                            placeholder={t('ordersAdmin.searchPlaceholder')}
                            allowClear
                            style={{ width: 220 }}
                            prefix={<SearchOutlined />}
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            className="points-config-form"
                          />
                          <Select
                            placeholder={t('ordersAdmin.selectStatus')}
                            style={{ width: 110 }}
                            allowClear
                            value={statusFilter}
                            onChange={setStatusFilter}
                            className="gold-select"
                            popupClassName="gold-select-dropdown"
                          >
                            <Option value="pending">{t('ordersAdmin.status.pending')}</Option>
                            <Option value="confirmed">{t('ordersAdmin.status.confirmed')}</Option>
                            <Option value="shipped">{t('ordersAdmin.status.shipped')}</Option>
                            <Option value="delivered">{t('ordersAdmin.status.delivered')}</Option>
                            <Option value="cancelled">{t('ordersAdmin.status.cancelled')}</Option>
                          </Select>
                          <Select
                            placeholder={t('ordersAdmin.payment.title')}
                            style={{ width: 110 }}
                            allowClear
                            value={paymentFilter}
                            onChange={setPaymentFilter}
                            className="gold-select"
                            popupClassName="gold-select-dropdown"
                          >
                            <Option value="credit">{t('ordersAdmin.payment.credit')}</Option>
                            <Option value="paypal">PayPal</Option>
                            <Option value="bank_transfer">{t('ordersAdmin.payment.bankTransfer')}</Option>
                          </Select>
                          <Select
                            placeholder={t('ordersAdmin.financialStatus')}
                            style={{ width: 140 }}
                            value={matchStatusTab}
                            onChange={setMatchStatusTab}
                            className="gold-select"
                            popupClassName="gold-select-dropdown"
                          >
                            <Option value="all">{t('common.all')} ({orders.length})</Option>
                            <Option value="matched">{t('financeAdmin.fullyMatched')} ({matchedCount})</Option>
                            <Option value="unmatched">{t('financeAdmin.partialMatched')} ({unmatchedCount})</Option>
                          </Select>
                          <DatePicker.RangePicker
                            placeholder={[t('common.startDate'), t('common.endDate')]}
                            value={dateRange}
                            onChange={setDateRange}
                            className="points-config-form"
                          />
                          <CreateButton
                            onCreate={() => setCreating(true)}
                            buttonText={t('ordersAdmin.createManual')}
                            size="middle"
                            type="default"
                            showIcon={true}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              borderRadius: 8,
                              padding: '8px 16px',
                              background: appConfig?.colorTheme?.primaryButton
                                ? `linear-gradient(to right, ${appConfig.colorTheme.primaryButton.startColor}, ${appConfig.colorTheme.primaryButton.endColor})`
                                : 'linear-gradient(to right,#FDE08D,#C48D3A)',
                              color: '#111',
                              fontWeight: 700,
                              border: 'none',
                              cursor: 'pointer'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setKeyword('')
                              setStatusFilter(undefined)
                              setPaymentFilter(undefined)
                              setMatchStatusTab('all')
                              setDateRange(null)
                              setSelectedRowKeys([])
                            }}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              background: 'rgba(255, 255, 255, 0.1)',
                              color: '#FFFFFF',
                              cursor: 'pointer'
                            }}
                          >
                            {t('common.resetFilters')}
                          </button>
                        </Space>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ marginBottom: 8 }}>
                          <Search
                            placeholder={t('ordersAdmin.searchPlaceholder')}
                            allowClear
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            className="points-config-form"
                          />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <DatePicker.RangePicker
                            style={{ width: '100%' }}
                            placeholder={[t('common.startDate'), t('common.endDate')]}
                            value={dateRange}
                            onChange={setDateRange}
                            className="points-config-form"
                          />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ position: 'relative', width: 'calc(50% - 4px)' }}>
                            <Select
                              placeholder={t('ordersAdmin.allStatus')}
                              allowClear
                              value={statusFilter}
                              onChange={setStatusFilter}
                              style={{ width: '100%' }}
                              className="gold-select"
                              popupClassName="gold-select-dropdown"
                            >
                              <Option value="pending">{t('ordersAdmin.status.pending')}</Option>
                              <Option value="confirmed">{t('ordersAdmin.status.confirmed')}</Option>
                              <Option value="shipped">{t('ordersAdmin.status.shipped')}</Option>
                              <Option value="delivered">{t('ordersAdmin.status.delivered')}</Option>
                              <Option value="cancelled">{t('ordersAdmin.status.cancelled')}</Option>
                            </Select>
                          </div>
                          <div style={{ position: 'relative', width: 'calc(50% - 4px)' }}>
                            <Select
                              placeholder={t('ordersAdmin.payment.title')}
                              allowClear
                              value={paymentFilter}
                              onChange={setPaymentFilter}
                              style={{ width: '100%' }}
                              className="gold-select"
                              popupClassName="gold-select-dropdown"
                            >
                              <Option value="bank_transfer">{t('ordersAdmin.payment.bankTransfer')}</Option>
                              <Option value="credit">{t('ordersAdmin.payment.credit')}</Option>
                              <Option value="paypal">PayPal</Option>
                            </Select>
                          </div>
                          <div style={{ position: 'relative', width: '100%' }}>
                            <Select
                              placeholder={t('ordersAdmin.financialStatus')}
                              value={matchStatusTab}
                              onChange={setMatchStatusTab}
                              style={{ width: '100%' }}
                              className="gold-select"
                              popupClassName="gold-select-dropdown"
                            >
                              <Option value="all">{t('common.all')} ({orders.length})</Option>
                              <Option value="matched">{t('financeAdmin.fullyMatched')} ({matchedCount})</Option>
                              <Option value="unmatched">{t('financeAdmin.partialMatched')} ({unmatchedCount})</Option>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* 列表滚动容器开始：仅列表滚动 */}
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingBottom: 16
                  }}
                >
                  {!isMobile ? (
                    <div className="points-config-form">
                      {loading || paginatedLoading ? (
                        <OrderSkeleton isMobile={false} />
                      ) : (
                        <Table
                          columns={columns}
                          dataSource={filteredSorted}
                          rowKey="id"
                          loading={loading || paginatedLoading}
                          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
                          virtual={filteredSorted.length > 50}
                          scroll={{
                            y: 'calc(100vh - 350px)',
                            x: 'max-content'
                          }}

                          pagination={{
                            current: pagination.current,
                            pageSize: pagination.pageSize,
                            total: filteredSorted.length,
                            showSizeChanger: true,
                            showQuickJumper: false,
                            showTotal: (total, range) => t('common.paginationTotal', { start: range[0], end: range[1], total }),
                            onChange: handlePaginationChange,
                            onShowSizeChange: handlePaginationChange,
                            pageSizeOptions: ['10', '20', '50', '100'],
                            style: { color: '#fff' }
                          }}
                          style={{
                            background: 'transparent'
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {loading || paginatedLoading ? (
                        <OrderSkeleton isMobile={true} />
                      ) : (
                        <>
                          {filteredSorted.map((order: Order) => {
                            const matchStatus = getOrderMatchStatus(order.id)
                            const createdDate = order.createdAt ?
                              (typeof (order.createdAt as any).toDate === 'function' ? (order.createdAt as any).toDate() : order.createdAt)
                              : new Date()
                            const formattedDate = dayjs(createdDate).isValid() ? dayjs(createdDate).format('DD MMM YYYY') : '-'

                            return (
                              <div key={order.id} style={{ border: '1px solid rgba(244,175,37,0.2)', borderRadius: 12, padding: 12, background: 'rgba(34,28,16,0.5)', backdropFilter: 'blur(10px)' }}>
                                {/* 订单号和日期同行 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                                  <div style={{ minWidth: 0, flex: 1, fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>
                                    {t('ordersAdmin.orderNo')}: <Button
                                      type="link"
                                      style={{
                                        padding: 0,
                                        height: 'auto',
                                        fontFamily: 'monospace',
                                        fontSize: 12,
                                        color: '#FDE08D',
                                        fontWeight: 600,
                                        maxWidth: '100%',
                                        whiteSpace: 'normal',
                                        overflowWrap: 'anywhere',
                                        textAlign: 'left',
                                      }}
                                      onClick={() => handleViewOrder(order)}
                                    >
                                      {order.id.substring(0, 20)}
                                    </Button>
                                  </div>
                                  <div style={{ flexShrink: 0, fontSize: 12, color: '#CCCCCC', textAlign: 'right' }}>
                                    {formattedDate}
                                  </div>
                                </div>

                                {/* 用户名和状态同行 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
                                    {getUserName(order.userId, users)}
                                  </div>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: getStatusColor(order.status) === 'green' ? '#34d399' : getStatusColor(order.status) === 'red' ? '#f87171' : getStatusColor(order.status) === 'orange' ? '#fb923c' : getStatusColor(order.status) === 'blue' ? '#60a5fa' : '#a78bfa' }}>
                                    {getStatusText(order.status, t)}
                                  </span>
                                </div>

                                {/* 手机号和查看按钮同行 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                  <div style={{ fontSize: 11, color: '#CCCCCC' }}>
                                    {getUserPhone(order.userId, users) || '-'}
                                  </div>
                                  <button style={{ padding: '4px 8px', borderRadius: 6, background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#221c10', fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => { openDrawer(order); setIsEditingInView(false) }}>
                                    {t('common.viewDetails')}
                                  </button>
                                </div>

                                {/* 商品列表和金额 */}
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(244,175,37,0.1)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                  {/* 商品列表 */}
                                  <div style={{ flex: 1 }}>
                                    {order.items.slice(0, 2).map((item: any, index: number) => (
                                      <div key={`${order.id}_${item.cigarId}_${index}`} style={{ fontSize: 12, color: '#FFFFFF', marginBottom: 4 }}>
                                        • {getCigarName(item.cigarId)} × <span style={{ color: '#FDE08D', fontWeight: 600 }}>{item.quantity}</span>
                                      </div>
                                    ))}
                                    {order.items.length > 2 && (
                                      <div style={{ fontSize: 11, color: '#CCCCCC', marginTop: 4 }}>
                                        +{order.items.length - 2} {t('common.more')}
                                      </div>
                                    )}
                                  </div>

                                  {/* 金额和财务匹配状态 */}
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div style={{ fontSize: 16, fontWeight: 800, color: '#f4af25' }}>RM {order.total.toFixed(2)}</div>
                                      {/* 财务匹配状态 */}
                                      {matchStatus.status === 'fully' && (
                                        <CheckOutlined style={{ color: '#34d399', fontSize: '16px' }} />
                                      )}
                                    </div>
                                    {matchStatus.status === 'partial' && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                        <ClockCircleOutlined style={{ color: '#fb923c', fontSize: '14px' }} />
                                        <span style={{ fontSize: 10, color: '#fb923c' }}>RM{matchStatus.matched.toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                          {filteredSorted.length === 0 && (
                            <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>{t('common.noData')}</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          },
          {
            key: 'invoices',
            label: t('ordersAdmin.tabs.invoices'),
            children: (
              <InvoiceManagementTab
                orders={filteredSorted}
                users={users}
                cigars={cigars}
                transactions={transactions}
                appConfig={appConfig}
                loading={loading || paginatedLoading}
                isMobile={isMobile}
                onRefresh={refreshAllOrders}
                onViewOrder={handleViewOrder}
              />
            ),
          }
        ]}
      />

      {/* 查看订单详情 */}
      <Drawer
        open={drawerOpen}
        onClose={() => { closeDrawer(); setIsEditingInView(false) }}
        width={isMobile ? '100%' : 820}
        styles={{
          body: { padding: 0, background: '#1a160d' },
          header: { background: '#1a160d', borderBottom: '1px solid rgba(244,175,37,0.2)' }
        }}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f4af25', fontWeight: 800 }}>
              {t('ordersAdmin.orderNo')}: {viewing?.id}
            </span>
          </div>
        }
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined style={{ color: '#fff' }} />}
            onClick={() => { closeDrawer(); setIsEditingInView(false) }}
          />
        }
      >
        {viewing && (
          <OrderDetails
            order={viewing}
            users={users}
            cigars={cigars}
            isMobile={isMobile}
            isEditingInView={isEditingInView}
            onClose={() => { closeDrawer(); setIsEditingInView(false) }}
            onEditToggle={() => setIsEditingInView(v => !v)}
            onOrderUpdate={async () => {
              await refreshPaginated()
            }}
          />
        )}
      </Drawer>

      {/* 手动创建订单 */}
      <Modal
        title={t('ordersAdmin.createManual')}
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => {/* Form submission handled by CreateOrderForm */ }}
        confirmLoading={loading}
        {...getResponsiveModalConfig(isMobile, true, 960)}
        className="create-order-modal"
        footer={[
          <button
            key="cancel"
            type="button"
            onClick={() => setCreating(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              cursor: 'pointer'
            }}
          >
            {t('common.cancel')}
          </button>,
          <button
            key="submit"
            type="button"
            className="cigar-btn-gradient"
            onClick={() => {
              const formEl = document.getElementById('createOrderForm') as HTMLFormElement | null
              if (formEl) formEl.requestSubmit()
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            {t('common.create')}
          </button>
        ]}
        okButtonProps={{
          style: {
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            border: 'none',
            color: '#111',
            fontWeight: 700
          }
        }}
        cancelButtonProps={{
          style: {
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#FFFFFF'
          }
        }}
        styles={{
          content: {
            background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
            border: '1px solid rgba(244, 175, 37, 0.6)'
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
        <CreateOrderForm
          users={users}
          cigars={cigars}
          onCreateSuccess={async () => {
            message.success(t('ordersAdmin.created'))
            setCreating(false)
            await refreshPaginated()
          }}
          onCreateError={(error) => {
            message.error(error)
          }}
          onCancel={() => setCreating(false)}
          loading={loading}
        />
      </Modal>
      {/* 移动端悬浮创建按钮 */}
      {isMobile && mainTab === 'orders' && (
        <button
          onClick={() => setCreating(true)}
          style={{
            position: 'fixed',
            right: 20,
            bottom: (selectedRowKeys.length > 0 && mainTab === 'orders') ? 100 : 80,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: appConfig?.colorTheme?.primaryButton
              ? `linear-gradient(to right, ${appConfig.colorTheme.primaryButton.startColor}, ${appConfig.colorTheme.primaryButton.endColor})`
              : 'linear-gradient(to right,#FDE08D,#C48D3A)',
            border: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            color: '#111',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'pointer'
          }}
        >
          <PlusOutlined style={{ fontSize: 24, fontWeight: 'bold' }} />
        </button>
      )}
      {/* 批量操作底部工具栏 */}
      {selectedRowKeys.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: isMobile ? 20 : 30,
          left: '50%',
          transform: 'translateX(-50%)',
          width: isMobile ? 'calc(100% - 32px)' : 'auto',
          minWidth: isMobile ? 0 : 700,
          background: 'rgba(24, 28, 16, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(244, 175, 37, 0.5)',
          borderRadius: 16,
          padding: isMobile ? '12px 16px' : '12px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          zIndex: 1100,
          animation: 'slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#111',
              fontWeight: 800,
              fontSize: 14
            }}>
              {selectedRowKeys.length}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600 }}>
              {t('common.itemsSelected', { count: selectedRowKeys.length })}
            </div>
          </div>

          <Space size={isMobile ? 'small' : 'middle'} wrap>
            <button
              onClick={async () => {
                setLoading(true)
                try {
                  await Promise.all(selectedRowKeys.map(id => updateDocument<Order>(COLLECTIONS.ORDERS, String(id), { status: 'confirmed' } as any)))
                  message.success(t('ordersAdmin.batchConfirmed'))
                  await refreshPaginated()
                  setSelectedRowKeys([])
                } finally {
                  setLoading(false)
                }
              }}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#FFFFFF',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              {t('ordersAdmin.batchConfirm')}
            </button>
            <button
              onClick={async () => {
                setLoading(true)
                try {
                  await Promise.all(selectedRowKeys.map(id => updateDocument<Order>(COLLECTIONS.ORDERS, String(id), { status: 'delivered' } as any)))
                  message.success(t('ordersAdmin.batchDelivered'))
                  await refreshPaginated()
                  setSelectedRowKeys([])
                } finally {
                  setLoading(false)
                }
              }}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#FFFFFF',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              {t('ordersAdmin.batchDeliver')}
            </button>
            <button
              onClick={async () => {
                setLoading(true)
                try {
                  // 批量取消：自动退还积分支付的订单
                  const results = await Promise.all(selectedRowKeys.map(id => refundOrderPoints(String(id))))
                  const totalRefunded = results.reduce((sum, r) => sum + (r.refunded || 0), 0)
                  // 对于非积分支付的订单，仍需手动更新状态
                  const nonPointsOrders = selectedRowKeys.filter((id, idx) => results[idx].refunded === 0)
                  if (nonPointsOrders.length > 0) {
                    await Promise.all(nonPointsOrders.map(id => updateDocument<Order>(COLLECTIONS.ORDERS, String(id), { status: 'cancelled' } as any)))
                  }
                  const msg = totalRefunded > 0 
                    ? `${t('ordersAdmin.batchCancelled')} (${t('ordersAdmin.pointsRefunded', { points: totalRefunded })})`
                    : t('ordersAdmin.batchCancelled')
                  message.success(msg)
                  await refreshPaginated()
                  setSelectedRowKeys([])
                } finally {
                  setLoading(false)
                }
              }}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#FFFFFF',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              {t('ordersAdmin.batchCancel')}
            </button>
            <BatchDeleteButton
              selectedIds={selectedRowKeys}
              confirmTitle={t('ordersAdmin.batchDeleteConfirm')}
              confirmContent={t('ordersAdmin.batchDeleteContent', { count: selectedRowKeys.length })}
              onBatchDelete={async (ids) => {
                // 批量删除前先退还积分并清理记录
                await Promise.all(ids.map(id => deleteOrderWithRefund(String(id))))
                await deleteOrdersFromEventAllocations(ids.map(String))
                await Promise.all(ids.map(id => deleteOrderOutboundRecords(id)))
                await Promise.all(ids.map(id => deleteDocument(COLLECTIONS.ORDERS, id)))
                return { success: true }
              }}
              onSuccess={async () => {
                await refreshPaginated()
                setSelectedRowKeys([])
              }}
              itemTypeName={t('ordersAdmin.order')}
              size="middle"
              type="default"
              danger={true}
              showIcon={true}
              style={{
                background: 'rgba(255, 77, 79, 0.8)',
                border: 'none',
                color: '#FFFFFF',
                fontWeight: 700,
                borderRadius: 8,
                padding: '8px 16px'
              }}
            />
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <button
              onClick={() => setSelectedRowKeys([])}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              {t('common.cancel')}
            </button>
          </Space>
        </div>
      )}
      <style>{`
        @keyframes slideUp {
          from { transform: translate(-50%, 100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export default AdminOrders
