import React, { useState } from 'react'
import { Card, Button, Row, Col, Typography, Space, App, DatePicker, Tag, Divider, Tabs } from 'antd'
import { 
  FileExcelOutlined, 
  TeamOutlined, 
  DatabaseOutlined, 
  ShoppingCartOutlined, 
  CalendarOutlined,
  DownloadOutlined,
  BarChartOutlined,
  HistoryOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { 
  getUsers, 
  getCigars, 
  getAllOrders, 
  getEvents, 
  getAllInventoryMovements,
  getAllInboundOrders,
  getAllOutboundOrders
} from '../../../services/firebase/firestore'
import { getAppConfig } from '../../../services/firebase/appConfig'
import { useAuthStore } from '../../../store/modules/auth'
import AuditLogTab from './AuditLogTab'

const { Title, Text, Paragraph } = Typography
const { RangePicker } = DatePicker

const AdminReports: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const [exporting, setExporting] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('export')
  
  // Date range states
  const [orderRange, setOrderRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [eventRange, setEventRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [inventoryRange, setInventoryRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)

  const downloadExcel = async (data: any[], fileName: string, sheetName: string) => {
    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    XLSX.writeFile(workbook, `${fileName}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`)
  }

  const downloadMultiSheetExcel = async (sheets: { data: any[]; name: string }[], fileName: string) => {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    for (const sheet of sheets) {
      const worksheet = XLSX.utils.json_to_sheet(sheet.data)
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
    }
    XLSX.writeFile(workbook, `${fileName}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`)
  }

  const exportMembers = async () => {
    setExporting('members')
    try {
      const [users, config] = await Promise.all([getUsers(), getAppConfig()])
      
      let exportUsers = users
      const currentPlanId = config?.subscription?.planId || config?.subscription?.plan
      const currentPlan = config?.subscription?.plans?.find(p => p.id === currentPlanId)
      
      if (currentPlan && currentPlan.maxMembers && users.length > currentPlan.maxMembers) {
        // 按创建时间排序，保留最早的 maxMembers 个用户
        exportUsers = [...users].sort((a, b) => {
          const d1 = (a.createdAt as any)?.toDate?.() || a.createdAt
          const d2 = (b.createdAt as any)?.toDate?.() || b.createdAt
          return new Date(d1).getTime() - new Date(d2).getTime()
        }).slice(0, currentPlan.maxMembers)
        
        message.info(t('reports.memberLimitInfo', { maxMembers: currentPlan.maxMembers, name: currentPlan.name }))
      }

      const exportData = exportUsers.map(u => ({
        'Member ID': u.memberId || '-',
        'Name': u.displayName || '-',
        'Email': u.email || '-',
        'Phone': (u as any).phone || (u as any).profile?.phone || '-',
        'Role': u.role || 'member',
        'Level': u.membership?.level || 'bronze',
        'Points': u.membership?.points || 0,
        'Created At': u.createdAt ? dayjs((u.createdAt as any)?.toDate?.() || u.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-'
      }))
      downloadExcel(exportData, 'Members_Report', 'Members')
      message.success(t('messages.operationSuccess'))
    } catch (error) {
      console.error('Export members error:', error)
      message.error(t('messages.operationFailed'))
    } finally {
      setExporting(null)
    }
  }

  const exportInventory = async () => {
    setExporting('inventory')
    try {
      const [startDate, endDate] = inventoryRange
        ? [inventoryRange[0]?.toDate(), inventoryRange[1]?.toDate()]
        : [null, null]

      const [cigars, movements, inOrders, outOrders] = await Promise.all([
        getCigars({ limit: 2000 }),
        getAllInventoryMovements(undefined, { startDate, endDate, limit: 5000 }),
        getAllInboundOrders(undefined, { startDate, endDate, limit: 2000 }),
        getAllOutboundOrders(undefined, { startDate, endDate, limit: 2000 })
      ])

      const cigarMap = new Map(cigars.map(c => [c.id, c]))

      // --- Sheet 1: Movements (filtered by date range if set) ---
      let filteredMovements = movements
      if (inventoryRange) {
        const [start, end] = inventoryRange
        filteredMovements = movements.filter(m => {
          const date = dayjs((m.createdAt as any)?.toDate?.() || m.createdAt)
          return date.isAfter(start.startOf('day')) && date.isBefore(end.endOf('day'))
        })
      }

      const movementsData = [...filteredMovements]
        .sort((a, b) => {
          const da = dayjs((a.createdAt as any)?.toDate?.() || a.createdAt)
          const db = dayjs((b.createdAt as any)?.toDate?.() || b.createdAt)
          return db.valueOf() - da.valueOf()
        })
        .map(m => {
          let orderStatus = '-'
          if (m.inboundOrderId) {
            const ord = inOrders.find(o => o.id === m.inboundOrderId)
            orderStatus = ord?.status || '-'
          } else if (m.outboundOrderId) {
            const ord = outOrders.find(o => o.id === m.outboundOrderId)
            orderStatus = ord?.status || '-'
          }
          return {
            'Date': m.createdAt ? dayjs((m.createdAt as any)?.toDate?.() || m.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-',
            'Reference No': m.referenceNo || '-',
            'Direction': m.type === 'in' ? 'Inbound' : 'Outbound',
            'Product Name': m.cigarName || cigarMap.get(m.cigarId)?.name || m.cigarId || '-',
            'Item Type': m.itemType || '-',
            'Quantity': m.type === 'in' ? m.quantity : -m.quantity,
            'Unit Price': m.unitPrice ?? 0,
            'Reason': m.reason || '-',
            'Order Status': orderStatus
          }
        })

      // --- Sheet 2: Inventory – opening stock, closing stock, avg cost ---
      // Opening stock = all movements BEFORE date range start (0 when no range)
      // Closing stock = all movements UP TO date range end (all-time when no range)
      // Avg Stock Cost = weighted average unit price across all inbound movements
      const openingStockMap = new Map<string, number>()
      const closingStockMap = new Map<string, number>()
      const totalInboundCostMap = new Map<string, number>()
      const totalInboundQtyMap = new Map<string, number>()

      for (const m of movements) {
        const id = m.cigarId
        if (!id || (m.itemType && m.itemType !== 'cigar')) continue
        if (m.inboundOrderId) {
          const order = inOrders.find(o => o.id === m.inboundOrderId)
          if (order && order.status === 'cancelled') continue
        }
        if (m.outboundOrderId) {
          const order = outOrders.find(o => o.id === m.outboundOrderId)
          if (order && order.status === 'cancelled') continue
        }
        const qty = Number.isFinite(m.quantity) ? Math.floor(m.quantity) : 0
        const movDate = dayjs((m.createdAt as any)?.toDate?.() || m.createdAt)

        if (inventoryRange) {
          const [start, end] = inventoryRange
          // Opening: strictly before the start of the selected range
          if (movDate.isBefore(start.startOf('day'))) {
            const prev = openingStockMap.get(id) ?? 0
            openingStockMap.set(id, m.type === 'in' ? prev + qty : prev - qty)
          }
          // Closing: up to and including the end of the selected range
          if (!movDate.isAfter(end.endOf('day'))) {
            const prev = closingStockMap.get(id) ?? 0
            closingStockMap.set(id, m.type === 'in' ? prev + qty : prev - qty)
          }
        } else {
          // No range → closing = current all-time stock; opening stays 0
          const prev = closingStockMap.get(id) ?? 0
          closingStockMap.set(id, m.type === 'in' ? prev + qty : prev - qty)
        }

        // Weighted average cost from inbound movements that have a unit price
        if (m.type === 'in' && m.unitPrice && m.unitPrice > 0) {
          totalInboundCostMap.set(id, (totalInboundCostMap.get(id) ?? 0) + qty * m.unitPrice)
          totalInboundQtyMap.set(id, (totalInboundQtyMap.get(id) ?? 0) + qty)
        }
      }

      const inventoryData = cigars.map(c => {
        const openingStock = openingStockMap.get(c.id) ?? 0
        const closingStock = closingStockMap.get(c.id) ?? 0
        const totalCost = totalInboundCostMap.get(c.id) ?? 0
        const totalQty = totalInboundQtyMap.get(c.id) ?? 0
        const avgCost = totalQty > 0 ? parseFloat((totalCost / totalQty).toFixed(2)) : 0
        const stockValue = parseFloat((closingStock * avgCost).toFixed(2))
        return {
          'Brand': c.brand || '-',
          'Product Name': c.name || '-',
          'Origin': c.origin || '-',
          'Specification': c.size || '-',
          'Selling Price (RM)': c.price || 0,
          'Opening Stock': openingStock,
          'Closing Stock': closingStock,
          'Buying Price (RM)': avgCost,
          'Stock Value (RM)': stockValue,
          'Unit': t('shop.sticks'),
          'Created At': c.createdAt ? dayjs((c.createdAt as any)?.toDate?.() || c.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-'
        }
      })

      await downloadMultiSheetExcel(
        [
          { data: movementsData, name: 'Movements' },
          { data: inventoryData, name: 'Inventory' }
        ],
        'Inventory_Report'
      )
      message.success(t('messages.operationSuccess'))
    } catch (error) {
      console.error('Export inventory error:', error)
      message.error(t('messages.operationFailed'))
    } finally {
      setExporting(null)
    }
  }

  const exportOrders = async () => {
    setExporting('orders')
    try {
      const [startDate, endDate] = orderRange
        ? [orderRange[0]?.toDate(), orderRange[1]?.toDate()]
        : [null, null]

      const [orders, cigars, users] = await Promise.all([
        getAllOrders(undefined, { startDate, endDate, limit: 5000 }),
        getCigars({ limit: 2000 }),
        getUsers({ limit: 500 })
      ])
      
      const cigarMap = new Map(cigars.map(c => [c.id, c.name]))
      const userMap = new Map(users.map(u => [u.id, u.displayName || u.email || u.id]))
      
      let filteredOrders = orders
      // Filter by date range if selected
      if (orderRange) {
        const [start, end] = orderRange
        filteredOrders = orders.filter(o => {
          const date = dayjs((o.createdAt as any)?.toDate?.() || o.createdAt)
          return date.isAfter(start.startOf('day')) && date.isBefore(end.endOf('day'))
        })
      }

      const exportData: any[] = []
      filteredOrders.forEach(o => {
        const orderDate = o.createdAt ? dayjs((o.createdAt as any)?.toDate?.() || o.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-'
        const customerName = userMap.get(o.userId) || o.userId
        
        if (!o.items || o.items.length === 0) {
          exportData.push({
            'Order No': o.orderNo || '-',
            'Order ID': o.id,
            'Created At': orderDate,
            'Customer': customerName,
            'Customer ID': o.userId,
            'Product Name': '-',
            'Quantity': 0,
            'Unit Price': 0,
            'Subtotal': 0,
            'Total Amount': o.total || 0,
            'Status': o.status,
            'Payment Method': o.payment?.method || '-'
          })
        } else {
          o.items.forEach(item => {
            const productName = item.name || cigarMap.get(item.cigarId) || item.cigarId || '-'
            exportData.push({
              'Order No': o.orderNo || '-',
              'Order ID': o.id,
              'Created At': orderDate,
              'Customer': customerName,
              'Customer ID': o.userId,
              'Product Name': productName,
              'Quantity': item.quantity || 0,
              'Unit Price': item.price || 0,
              'Subtotal': (item.quantity || 0) * (item.price || 0),
              'Total Amount': o.total || 0,
              'Status': o.status,
              'Payment Method': o.payment?.method || '-'
            })
          })
        }
      })

      downloadExcel(exportData, 'Orders_Report', 'Orders')
      message.success(t('messages.operationSuccess'))
    } catch (error) {
      console.error('Export orders error:', error)
      message.error(t('messages.operationFailed'))
    } finally {
      setExporting(null)
    }
  }

  const exportEvents = async () => {
    setExporting('events')
    try {
      let events = await getEvents()

      // Filter by date range if selected
      if (eventRange) {
        const [start, end] = eventRange
        events = events.filter(e => {
          const date = dayjs((e.schedule?.startDate as any)?.toDate?.() || e.schedule?.startDate)
          return date.isAfter(start.startOf('day')) && date.isBefore(end.endOf('day'))
        })
      }

      const exportData = events.map(e => ({
        'Event Name': e.title,
        'Organizer': e.organizerId || '-',
        'Location': e.location?.name || '-',
        'Start Time': e.schedule?.startDate ? dayjs((e.schedule.startDate as any)?.toDate?.() || e.schedule.startDate).format('YYYY-MM-DD HH:mm:ss') : '-',
        'End Time': e.schedule?.endDate ? dayjs((e.schedule.endDate as any)?.toDate?.() || e.schedule.endDate).format('YYYY-MM-DD HH:mm:ss') : '-',
        'Participants': e.participants?.registered?.length || 0,
        'Capacity': e.participants?.maxParticipants || '-',
        'Status': e.status,
        'Fee': e.participants?.fee || 0
      }))
      downloadExcel(exportData, 'Events_Report', 'Events')
      message.success(t('messages.operationSuccess'))
    } catch (error) {
      console.error('Export events error:', error)
      message.error(t('messages.operationFailed'))
    } finally {
      setExporting(null)
    }
  }

  const reportCards = [
    {
      key: 'members',
      title: t('navigation.users'),
      icon: <TeamOutlined style={{ fontSize: 32, color: '#f4af25' }} />,
      description: t('reports.membersExportDesc'),
      action: exportMembers,
      color: '#f4af25'
    },
    {
      key: 'inventory',
      title: t('navigation.inventory'),
      icon: <DatabaseOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
      description: t('reports.inventoryExportDesc'),
      action: exportInventory,
      hasFilter: true,
      range: inventoryRange,
      setRange: setInventoryRange,
      color: '#52c41a'
    },
    {
      key: 'orders',
      title: t('navigation.orders'),
      icon: <ShoppingCartOutlined style={{ fontSize: 32, color: '#1890ff' }} />,
      description: t('reports.ordersExportDesc'),
      action: exportOrders,
      hasFilter: true,
      range: orderRange,
      setRange: setOrderRange,
      color: '#1890ff'
    },
    {
      key: 'events',
      title: t('navigation.events'),
      icon: <CalendarOutlined style={{ fontSize: 32, color: '#eb2f96' }} />,
      description: t('reports.eventsExportDesc'),
      action: exportEvents,
      hasFilter: true,
      range: eventRange,
      setRange: setEventRange,
      color: '#eb2f96'
    }
  ]

  const items = [
    {
      key: 'export',
      label: (
        <Space>
          <FileExcelOutlined />
          <span>{t('reports.tabExcelReports')}</span>
        </Space>
      ),
      children: (
        <Row gutter={[24, 24]} style={{ marginTop: 16 }}>
          {reportCards.map(card => (
            <Col xs={24} sm={12} key={card.key}>
              <Card
                hoverable
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid rgba(255, 255, 255, 0.1)`,
                  borderRadius: 16,
                  backdropFilter: 'blur(10px)',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column'
                }}
                styles={{
                  body: { padding: '24px', flex: 1, display: 'flex', flexDirection: 'column' }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                  <div style={{ 
                    background: `rgba(${card.color === '#f4af25' ? '244, 175, 37' : card.color === '#52c41a' ? '82, 196, 26' : card.color === '#1890ff' ? '24, 144, 255' : '235, 47, 150'}, 0.1)`, 
                    padding: 16, 
                    borderRadius: 12 
                  }}>
                    {card.icon}
                  </div>
                  <Tag color={card.color} style={{ margin: 0, borderRadius: 4, fontWeight: 600 }}>EXCEL</Tag>
                </div>

                <Title level={4} style={{ color: '#FFFFFF', marginBottom: 8 }}>{card.title}</Title>
                <Paragraph style={{ color: 'rgba(255, 255, 255, 0.5)', marginBottom: 24, fontSize: 14 }}>
                  {card.description}
                </Paragraph>

                <div style={{ marginTop: 'auto' }}>
                  {card.hasFilter && (
                    <div style={{ marginBottom: 16 }}>
                      <Text style={{ color: 'rgba(255, 255, 255, 0.45)', display: 'block', fontSize: 12, marginBottom: 8 }}>
                        {t('reports.dateRangeOptional')}
                      </Text>
                      <RangePicker 
                        className="points-config-form"
                        style={{ width: '100%' }}
                        onChange={(dates) => card.setRange(dates as any)}
                      />
                    </div>
                  )}
                  
                  <Button 
                    type="primary" 
                    icon={<DownloadOutlined />} 
                    block
                    loading={exporting === card.key}
                    onClick={card.action}
                    style={{
                      background: `linear-gradient(135deg, ${card.color} 0%, ${card.color}dd 100%)`,
                      border: 'none',
                      height: 48,
                      borderRadius: 12,
                      fontWeight: 700,
                      boxShadow: `0 4px 14px 0 rgba(0, 0, 0, 0.25)`
                    }}
                  >
                    {t('common.exportReport')}
                  </Button>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )
    },
    {
      key: 'logs',
      label: (
        <Space>
          <HistoryOutlined />
          <span>{t('reports.tabOperationLogs')}</span>
        </Space>
      ),
      children: <AuditLogTab />
    }
  ]

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ color: '#f4af25', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <BarChartOutlined /> {t('navigation.reports')}
        </Title>
        <Paragraph style={{ color: 'rgba(255, 255, 255, 0.65)', fontSize: 16 }}>
          {t('reports.subtitle')}
        </Paragraph>
      </div>

      <Tabs 
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        className="points-config-form"
        style={{ color: '#fff' }}
      />

      <Divider style={{ borderColor: 'rgba(255, 255, 255, 0.05)', margin: '48px 0' }} />
      
      <div style={{ textAlign: 'center' }}>
        <Text style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: 12 }}>
          © {dayjs().year()} {t('common.appName') || 'MS'}. {t('reports.footerSuffix')}
        </Text>
      </div>
    </div>
  )
}

export default AdminReports
