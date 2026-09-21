// 活动管理页面
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Table, Button, Tag, Space, Input, Select, DatePicker, App, Modal, Form, InputNumber, Switch, Dropdown, Checkbox, Upload, Spin, Descriptions, Progress, Tabs, Row, Col } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, EyeOutlined, DownloadOutlined, UploadOutlined, UserOutlined, CheckCircleOutlined, NotificationOutlined, CalendarOutlined } from '@ant-design/icons'
import type { Event, User, Cigar, Transaction } from '../../../types'
import AnnouncementsAdmin from '../../../components/admin/AnnouncementsAdmin'
import { getEvents, createDocument, updateDocument, deleteDocument, COLLECTIONS, getUsers, registerForEvent, unregisterFromEvent, getCigars, createOrdersFromEventAllocations, getAllOrders, getUsersByIds, getEventById, getAllTransactions } from '../../../services/firebase/firestore'
import ParticipantsList from '../../../components/admin/ParticipantsList'
import ParticipantsSummary from '../../../components/admin/ParticipantsSummary'
import ImageUpload from '../../../components/common/ImageUpload'
import ActionButtons from '../../../components/common/ActionButtons'
import BatchDeleteButton from '../../../components/common/BatchDeleteButton'
import EventSearchBar from '../../../components/admin/EventSearchBar'
import EventCard from '../../../components/admin/EventCard'
import EventDetailsView from '../../../components/admin/EventDetailsView'
import EventParticipantsManager from '../../../components/admin/EventParticipantsManager'
import StatusFilterDropdown from '../../../components/admin/StatusFilterDropdown'
import { useTranslation } from 'react-i18next'
import { getResponsiveModalConfig, getModalTheme } from '../../../config/modalTheme'
import { useAuthStore } from '../../../store/modules/auth'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'

const { Option } = Select

// Constants
const DEFAULT_MAX_PARTICIPANTS = 0
const DEFAULT_FEE = 0
const DEFAULT_STATUS = 'draft'

// 活动财务标签页组件
// Event Status Configuration
const EVENT_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published', 
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
} as const

type EventStatus = typeof EVENT_STATUSES[keyof typeof EVENT_STATUSES]

// Status validation and transition rules
const STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  [EVENT_STATUSES.DRAFT]: [EVENT_STATUSES.PUBLISHED, EVENT_STATUSES.CANCELLED],
  [EVENT_STATUSES.PUBLISHED]: [EVENT_STATUSES.ONGOING, EVENT_STATUSES.CANCELLED],
  [EVENT_STATUSES.ONGOING]: [EVENT_STATUSES.COMPLETED, EVENT_STATUSES.CANCELLED],
  [EVENT_STATUSES.COMPLETED]: [], // Terminal state
  [EVENT_STATUSES.CANCELLED]: [] // Terminal state
}

const AdminEvents: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en'
  const { user: currentUser } = useAuthStore()

  // Page-level tab: events | announcements
  const [pageTab, setPageTab] = useState<'events' | 'announcements'>('events')

  // Loading states (for form submit / delete operations)
  const [loading, setLoading] = useState(false)
  const [participantsLoading, setParticipantsLoading] = useState(false)

  // Data hooks
  const fetchEventsWithAutoAdjust = useCallback(async () => {
    const list = await getEvents()
    const updatedList: Event[] = []
    for (const event of list) {
      const updatedStatus = await autoAdjustEventStatus(event)
      updatedList.push({ ...event, status: updatedStatus })
    }
    return updatedList
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { data: events = [], loading: eventsLoading, refresh: refreshEvents } = useFirestoreQuery(fetchEventsWithAutoAdjust)
  const { data: participantsUsers = [] } = useFirestoreQuery(() => getUsers({ limit: 500 }))
  const { data: cigars = [] } = useFirestoreQuery(getCigars)
  const [allocSaving, setAllocSaving] = useState<string | null>(null)
  
  // Modal states
  const [creating, setCreating] = useState(false)
  const { item: editing, open: editingOpen, openDrawer: openEditing, closeDrawer: closeEditing } = useDetailDrawer<Event>()
  const [deleting, setDeleting] = useState<Event | null>(null)
  const { item: viewing, open: viewingOpen, openDrawer: openViewing, closeDrawer: closeViewing } = useDetailDrawer<Event>()
  const [participantsEvent, setParticipantsEvent] = useState<Event | null>(null)
  
  // UI states
  const [activeViewTab, setActiveViewTab] = useState<string>('overview')
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [manualAddLoading, setManualAddLoading] = useState(false)
  const [manualAddValue, setManualAddValue] = useState<string>('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [orderSyncing, setOrderSyncing] = useState(false)

  const openNewEvent = () => {
    const newEvent: Event = {
      id: 'new',
      title: '',
      description: '',
      organizerId: '',
      status: 'draft',
      schedule: {
        startDate: new Date(),
        endDate: new Date(),
        registrationDeadline: new Date()
      },
      location: {
        name: '',
        address: ''
      },
      participants: {
        fee: 0,
        maxParticipants: 50,
        registered: []
      },
      cigars: {
        featured: [],
        tasting: []
      },
      image: '',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    openViewing(newEvent)
    setIsEditingDetails(true)
    setEditForm({
      title: '',
      description: '',
      image: '',
      status: 'draft',
      startDate: dayjs(),
      endDate: dayjs(),
      locationName: '',
      fee: 0,
      maxParticipants: 0
    })
  }
  
  // Form instance
  const [form] = Form.useForm()
  // ===== STATUS MANAGEMENT UTILITIES =====
  
  // Validate status transition
  const isValidStatusTransition = (currentStatus: string, newStatus: string): boolean => {
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus as EventStatus] || []
    return allowedTransitions.includes(newStatus as EventStatus) || currentStatus === newStatus
  }

  // Get available status options based on current status
  const getAvailableStatusOptions = (currentStatus: string): EventStatus[] => {
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus as EventStatus] || []
    return [currentStatus as EventStatus, ...allowedTransitions]
  }

  // Validate event status based on dates
  const calculateEventStatus = (event: Event): EventStatus => {
    const now = new Date()
    const startDate = toDateOrNull(event.schedule?.startDate)
    const endDate = toDateOrNull(event.schedule?.endDate)
    
    if (!startDate || !endDate) return EVENT_STATUSES.DRAFT
    
    if (now < startDate) return EVENT_STATUSES.PUBLISHED
    if (now >= startDate && now <= endDate) return EVENT_STATUSES.ONGOING
    if (now > endDate) return EVENT_STATUSES.COMPLETED
    
    return EVENT_STATUSES.DRAFT
  }

  // ===== UTILITY FUNCTIONS =====
  
  const getCigarPriceById = (id?: string): number => {
    if (!id) return 0
    const cigar = cigars.find(x => x.id === id)
    return cigar?.price ?? 0
  }

  const getCigarCostById = (id?: string): number => {
    if (!id) return 0
    const cigar = cigars.find(x => x.id === id)
    // 如果 Cigar 类型中有 cost 字段，使用它；否则使用价格的 70% 作为默认成本
    return (cigar as any)?.cost ?? (cigar?.price ?? 0) * 0.7
  }


  // Date conversion utility
  const toDateOrNull = (val: any): Date | null => {
        if (!val) return null
    
    // dayjs object -> Date
    if (val && typeof val.toDate === 'function') {
      const d = val.toDate()
      return isNaN(d?.getTime?.() || NaN) ? null : d
    }
    
    // Firestore Timestamp -> Date
    if ((val as any)?.toDate && typeof (val as any).toDate === 'function') {
          const d = (val as any).toDate()
          return isNaN(d?.getTime?.() || NaN) ? null : d
        }
    
    // Date -> Date
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val
    }
    
    // Primitive/other -> Date
        const d = new Date(val)
        return isNaN(d.getTime()) ? null : d
      }

  const handleSaveField = async (fieldName: string) => {
    if (!viewing) return
    
    
    // 🔥 关键修复：创建模式下的特殊处理
    if (viewing.id === 'new') {
      // 特殊标识：一次性创建所有字段
      if (fieldName === '__CREATE_ALL__') {
        
        try {
          const newEventData: Partial<Event> = {
            title: editForm.title || '',
            description: editForm.description || '',
            image: editForm.image || '',
            status: editForm.status || 'draft',
            organizerId: '',
            schedule: {
              startDate: toDateOrNull(editForm.startDate) || new Date(),
              endDate: toDateOrNull(editForm.endDate) || new Date(),
              registrationDeadline: toDateOrNull(editForm.endDate) || new Date()
            },
            location: {
              name: editForm.locationName || '',
              address: ''
            },
            participants: {
              fee: editForm.fee !== undefined ? Number(editForm.fee) : 0,
              maxParticipants: editForm.maxParticipants !== undefined ? editForm.maxParticipants : 50,
              registered: []
            },
            cigars: {
              featured: [],
              tasting: []
            },
            isPrivate: !!editForm.isPrivate,
            storeId: currentUser?.storeId || '',
            creatorId: currentUser?.id || '',
            createdAt: new Date(),
            updatedAt: new Date()
          }
          
          
          const res = await createDocument<Event>(COLLECTIONS.EVENTS, newEventData as any)
          if (res.success) {
            message.success(t('common.created'))
            refreshEvents()
            const newEvent = await getEventById(res.id!)
            if (newEvent) {
              openViewing(newEvent as Event)
            }
          } else {
            message.error(t('common.createFailed'))
          }
        } catch (error) {
          console.error('🟢 CREATE MODE error:', error)
          message.error(t('common.createFailed'))
        }
        return
      }
      
      // 单字段保存：只更新本地状态，不创建文档
      console.warn('⚠️ CREATE MODE: Single field save blocked, only updating local state')
      
      const updatedViewing = { ...viewing }
      
      switch (fieldName) {
        case 'title':
          updatedViewing.title = editForm.title
          break
        case 'description':
          updatedViewing.description = editForm.description
          break
        case 'image':
          updatedViewing.image = editForm.image
          break
        case 'status':
          updatedViewing.status = editForm.status
          break
        case 'startDate':
          updatedViewing.schedule = {
            ...(viewing as any).schedule,
            startDate: toDateOrNull(editForm.startDate)
          }
          break
        case 'endDate':
          updatedViewing.schedule = {
            ...(viewing as any).schedule,
            endDate: toDateOrNull(editForm.endDate)
          }
          break
        case 'locationName':
          updatedViewing.location = {
            ...(viewing as any).location,
            name: editForm.locationName
          }
          break
        case 'fee':
        case 'maxParticipants':
          updatedViewing.participants = {
            ...(viewing as any).participants,
            ...(editForm.fee !== undefined ? { fee: Number(editForm.fee) } : {}),
            ...(editForm.maxParticipants !== undefined ? { maxParticipants: editForm.maxParticipants } : {})
          }
          break
        case 'isPrivate':
          updatedViewing.isPrivate = editForm.isPrivate
          break
      }
      
      openViewing(updatedViewing)
      // 不显示提示，避免干扰用户
      return
    }
    
    // 编辑模式：正常保存到数据库
    try {
      let updateData: any = {}
      
      switch (fieldName) {
        case 'title':
          updateData.title = editForm.title
          break
        case 'description':
          updateData.description = editForm.description
          break
        case 'image':
          updateData.image = editForm.image
          break
        case 'status':
          updateData.status = editForm.status
          break
        case 'startDate':
          updateData.schedule = {
            ...(viewing as any).schedule,
            startDate: toDateOrNull(editForm.startDate),
            endDate: editForm.endDate !== undefined ? toDateOrNull(editForm.endDate) : (viewing as any).schedule?.endDate
          }
          break
        case 'endDate':
          updateData.schedule = {
            ...(viewing as any).schedule,
            endDate: toDateOrNull(editForm.endDate),
            startDate: updateData.schedule?.startDate || (viewing as any).schedule?.startDate
          }
          break
        case 'locationName':
          updateData.location = {
            ...(viewing as any).location,
            name: editForm.locationName
          }
          break
        case 'fee':
        case 'maxParticipants': {
          const currentParticipants = (viewing as any).participants || {}
          const nextFee = editForm.fee !== undefined ? Number(editForm.fee) : currentParticipants.fee
          const nextMax = editForm.maxParticipants !== undefined ? editForm.maxParticipants : currentParticipants.maxParticipants
          updateData.participants = {
            ...currentParticipants,
            ...(nextFee !== undefined ? { fee: nextFee } : {}),
            ...(nextMax !== undefined ? { maxParticipants: nextMax } : {}),
          }
          break
          }
        case 'isPrivate':
          updateData.isPrivate = editForm.isPrivate
          break
      }

      updateData.updatedAt = new Date()

      
      const res = await updateDocument(COLLECTIONS.EVENTS, viewing.id, updateData)
      if (res.success) {
        message.success(t('common.saved'))
        refreshEvents()
        const updatedEvent = await getEventById(viewing.id)
        if (updatedEvent) {
          openViewing(updatedEvent as Event)
        }
      } else {
        message.error(t('common.saveFailed'))
      }
    } catch (error) {
      console.error('💾 handleSaveField error:', error)
      message.error(t('common.saveFailed'))
    }
  }
  
  // 编辑时初始化表单值
  useEffect(() => {
    if (editing) {
      form.setFieldsValue({
        title: editing.title,
        description: editing.description,
        locationName: (editing as any)?.location?.name || '',
        startDate: editing.schedule?.startDate ? dayjs(editing.schedule.startDate) : null,
        endDate: editing.schedule?.endDate ? dayjs(editing.schedule.endDate) : null,
        fee: (editing as any)?.participants?.fee || DEFAULT_FEE,
        maxParticipants: (editing as any)?.participants?.maxParticipants || DEFAULT_MAX_PARTICIPANTS,
        isPrivate: !!(editing as any)?.isPrivate,
        status: editing.status || DEFAULT_STATUS
      })
    }
  }, [editing, form])
  
  const toDayjs = (value: any) => {
    if (!value) return undefined
    if ((value as any)?.toDate && typeof (value as any).toDate === 'function') {
      return dayjs((value as any).toDate())
    }
    if (value instanceof Date) return dayjs(value)
    return dayjs(value)
  }

  // ===== DATA LOADING & INITIALIZATION =====
  // Data is loaded via useFirestoreQuery hooks above

  // ===== UI STATE MANAGEMENT =====
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    id: true,
    title: true,
    schedule: true,
    registration: true,
    isPrivate: true,
    revenue: true,
    status: true,
    action: true,
  })

  const threeMonthsAgo = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; }, [])
  const { data: orders = [] } = useFirestoreQuery(() => getAllOrders(undefined, { limit: 500 }))
  const { data: allTransactions = [] } = useFirestoreQuery(() => getAllTransactions(undefined, { startDate: threeMonthsAgo, limit: 1000 }), [threeMonthsAgo])
  
  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of orders) {
      const src = (o as any).source
      if (src?.type === 'event' && src?.eventId) {
        map[src.eventId] = (map[src.eventId] || 0) + (o.total || 0)
      }
    }
    return map
  }, [orders])

  // 计算每个活动的净利润（与 ParticipantsSummary 逻辑一致）
  const profitMap = useMemo(() => {
    const map: Record<string, number> = {}
    
    events.forEach(event => {
      // 计算产品总收入（基于 allocations）
      let productRevenue = 0
      const registeredParticipants = (event as any)?.participants?.registered || []
      registeredParticipants.forEach((uid: string) => {
        const allocation = (event as any)?.allocations?.[uid]
        if (!allocation) return
        
        const items = (allocation as any)?.items as Array<{ cigarId: string; quantity: number; unitPrice?: number }> | undefined
        if (Array.isArray(items) && items.length > 0) {
          productRevenue += items.reduce((s, it) => {
            const price = it?.unitPrice != null ? Number(it.unitPrice) : getCigarPriceById(it.cigarId)
            return s + (price * (it?.quantity || 1))
          }, 0)
        } else if (allocation?.amount != null) {
          productRevenue += allocation.amount
        } else {
          const qty = allocation?.quantity || 1
          productRevenue += getCigarPriceById(allocation?.cigarId) * qty
        }
      })
      
      // 计算活动费用总收入（基于 allocations）
      let feeRevenue = 0
      const feeUnitFallback = Number((event as any)?.participants?.fee || 0)
      registeredParticipants.forEach((uid: string) => {
        const alloc = (event as any)?.allocations?.[uid]
        if (!alloc) return
        const qty = (alloc as any)?.feeQuantity != null ? Number((alloc as any).feeQuantity) : 1
        const unit = (alloc as any)?.feeUnitPrice != null ? Number((alloc as any).feeUnitPrice) : feeUnitFallback
        if (unit > 0) {
          feeRevenue += unit * (qty > 0 ? qty : 1)
        }
      })
      
      // 总收入 = 产品收入 + 活动费用收入
      const totalRevenue = productRevenue + feeRevenue
      
      // 计算产品总成本（基于 allocations）
      let productCost = 0
      registeredParticipants.forEach((uid: string) => {
        const allocation = (event as any)?.allocations?.[uid]
        if (!allocation) return
        
        const items = (allocation as any)?.items as Array<{ cigarId: string; quantity: number }> | undefined
        if (Array.isArray(items) && items.length > 0) {
          productCost += items.reduce((s, it) => {
            return s + (getCigarCostById(it.cigarId) * (it?.quantity || 1))
          }, 0)
        } else {
          const qty = allocation?.quantity || 1
          productCost += getCigarCostById(allocation?.cigarId) * qty
        }
      })
      
      // 活动费用成本
      const feeCost = (event as any)?.participants?.feeCost ?? 0
      
      // 总支出 = 产品成本 + 活动费用成本
      const totalExpenses = productCost + feeCost
      
      // 净利润 = 总收入 - 总支出
      map[event.id] = totalRevenue - totalExpenses
    })
    
    return map
  }, [events, getCigarPriceById, getCigarCostById])

  // 计算活动的所有订单付款状态
  const getEventOrdersPaymentStatus = (event: any) => {
    const allocations = event.allocations || {}
    const registered = event.participants?.registered || []
    
    if (registered.length === 0) {
      return null
    }
    
    // 找出所有订单ID
    const orderIds: string[] = []
    let missingOrderCount = 0
    
    registered.forEach((uid: string) => {
      const alloc = allocations[uid]
      if (alloc?.orderId) {
        orderIds.push(alloc.orderId)
      } else {
        missingOrderCount++
      }
    })
    
    if (orderIds.length === 0) {
      return { status: 'no_orders', text: t('events.orderPending'), color: 'orange' }
    }
    
    // 检查所有订单的匹配状态
    let fullyPaidCount = 0
    let partialPaidCount = 0
    let unpaidCount = 0
    
    orderIds.forEach(orderId => {
      const order = orders.find(o => o.id === orderId)
      if (!order) {
        unpaidCount++
        return
      }
      
      const orderTotal = Number(order.total || 0)
      const matchedAmount = allTransactions
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
        fullyPaidCount++
      } else if (matchedAmount > 0) {
        partialPaidCount++
      } else {
        unpaidCount++
      }
    })
    
    const totalOrders = orderIds.length
    
    if (missingOrderCount > 0) {
      return {
        status: 'partial_generated',
        text: t('events.ordersMissing', { count: totalOrders, total: registered.length }),
        color: 'warning'
      }
    }
    
    if (fullyPaidCount === totalOrders) {
      return { status: 'all_paid', text: t('events.allPaid'), color: 'green' }
    }
    
    if (unpaidCount === totalOrders && partialPaidCount === 0) {
      return { status: 'all_unpaid', text: t('events.unpaid'), color: 'red' }
    }
    
    return {
      status: 'partially_paid',
      text: t('events.partiallyPaid', { paid: fullyPaidCount, total: totalOrders }),
      color: 'orange'
    }
  }

  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  const theme = getModalTheme()

  // Offset modals to account for sidebar width so they center in the content area
  const [siderOffset, setSiderOffset] = useState(0)
  useEffect(() => {
    const anyOpen = viewingOpen || creating || editingOpen
    if (anyOpen && !isMobile) {
      const sider = document.querySelector('.ant-layout-sider') as HTMLElement | null
      setSiderOffset(sider ? sider.offsetWidth / 2 : 120)
    }
  }, [viewingOpen, creating, editingOpen, isMobile])

  // 自动调整活动状态根据日期
  const autoAdjustEventStatus = async (event: Event) => {
    const now = new Date()
    const startDate = (event.schedule.startDate as any)?.toDate ? 
      (event.schedule.startDate as any).toDate() : 
      event.schedule.startDate
    const endDate = (event.schedule.endDate as any)?.toDate ? 
      (event.schedule.endDate as any).toDate() : 
      event.schedule.endDate

    if (!startDate || !endDate) return event.status

    let newStatus = event.status
    
    if (now < startDate) {
      // 活动未开始
      if (event.status === 'published') {
        newStatus = 'published'
      }
    } else if (now >= startDate && now <= endDate) {
      // 活动进行中
      if (event.status === 'published') {
        newStatus = 'ongoing'
      }
    } else if (now > endDate) {
      // 活动已结束 - 自动将任何非终止状态的活动设置为已结束
      if (event.status !== 'completed' && event.status !== 'cancelled') {
        newStatus = 'completed'
        // 自动创建订单
        try {
          const orderResult = await createOrdersFromEventAllocations(event.id)
          if (orderResult.success) {
            const totalOrders = orderResult.createdOrders + orderResult.updatedOrders;
            if (totalOrders > 0) {
              let messageText = t('common.eventAutoEndedWithOrders', { count: totalOrders });
              if (orderResult.createdOrders > 0 && orderResult.updatedOrders > 0) {
                messageText = `${orderResult.createdOrders} ${t('common.ordersCreated')}, ${orderResult.updatedOrders} ${t('common.ordersUpdated')}`;
              }
              message.success(messageText);
            }
          }
        } catch (error) {
          // 静默处理错误
          console.warn('Auto-create orders failed:', error);
        }
      }
    }

    // 如果状态发生变化，更新数据库
    if (newStatus !== event.status) {
      try {
        await updateDocument(COLLECTIONS.EVENTS, event.id, { status: newStatus } as any)
        return newStatus
      } catch (error) {
        // 静默处理错误
      }
    }
    
    return event.status
  }


  const filtered = useMemo(() => {
    return events.filter(e => {
      const kw = keyword.trim().toLowerCase()
      const passKw = !kw || e.title?.toLowerCase().includes(kw)
      const passStatus = !statusFilter || e.status === statusFilter
      return passKw && passStatus
    })
  }, [events, keyword, statusFilter])

  // 获取所有已完成的活动，用于计算社交关系
  const completedEvents = useMemo(() => {
    return events.filter(e => e.status === 'completed')
  }, [events])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'default'
      case 'published': return 'blue'
      case 'ongoing': return 'green'
      case 'completed': return 'default'
      case 'cancelled': return 'red'
      default: return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'draft': return t('events.draft')
      case 'published': return t('events.published')
      case 'ongoing': return t('events.ongoing')
      case 'completed': return t('events.completed')
      case 'cancelled': return t('events.cancelled')
      default: return t('profile.unknown')
    }
  }

  const getRegistrationProgress = (registered: number, maxParticipants: number) => {
    return (registered / maxParticipants) * 100
  }

  const columnsAll = [
    {
      title: t('events.eventName'),
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: any) => {
        const payStatus = getEventOrdersPaymentStatus(record)
        return (
          <div>
            <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ whiteSpace: 'nowrap' }}>{title}</span>
              {payStatus && (
                <Tag color={payStatus.color} style={{ margin: 0, fontSize: '10px', lineHeight: '16px', height: '18px' }}>
                  {payStatus.text}
                </Tag>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>
              {(record?.location?.name || '') && (
                <span style={{ marginRight: 8 }}>{record.location.name}</span>
              )}
              {(record.description || '').length > 50 
                ? `${record.description.substring(0, 50)}...` 
                : record.description}
            </div>
          </div>
        )
      },
    },
    {
      title: t('events.eventTime'),
      key: 'schedule',
      render: (_: any, record: any) => (
        <div>
          <div>
            {(() => {
              const s = (record?.schedule as any)?.startDate
              const dateVal = (s as any)?.toDate ? (s as any).toDate() : s
              return dateVal ? new Date(dateVal).toLocaleDateString() : '-'
            })()}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>
            {(() => {
              const e = (record?.schedule as any)?.endDate
              const dateVal = (e as any)?.toDate ? (e as any).toDate() : e
              return dateVal ? new Date(dateVal).toLocaleDateString() : '-'
            })()}
          </div>
        </div>
      ),
    },
    {
      title: t('events.registration'),
      key: 'registration',
      render: (_: any, record: any) => (
        <div>
          <div style={{ marginBottom: 4 }}>
            {(() => {
              const registered = ((record?.participants as any)?.registered || []).length
              const maxParticipants = (record?.participants as any)?.maxParticipants || 0
              return maxParticipants === 0 ? `${registered}/∞ ${t('events.people')}` : `${registered}/${maxParticipants} ${t('events.people')}`
            })()}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)', whiteSpace: 'nowrap' }}>
            {t('events.fee')}: RM{(record?.participants as any)?.fee ?? 0}
          </div>
        </div>
      ),
    },
    {
      title: t('events.revenue'),
      key: 'revenue',
      render: (_: any, record: any) => {
        const eventId = (record as any).id
        const revenue = revenueMap[eventId] ?? 0
        const profit = profitMap[eventId] ?? 0
        return (
          <div>
        <div style={{ fontWeight: 600, color: '#389e0d' }}>
              RM{revenue.toFixed(2)}
        </div>
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 600,
              color: '#1890ff',
              marginTop: 4
            }}>
              RM{profit.toFixed(2)}
            </div>
          </div>
        )
      },
    },
    {
      title: t('events.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>
          {getStatusText(status)}
        </Tag>
      ),
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />
      ),
      filterDropdown: (props: any) => (
        <StatusFilterDropdown
          setSelectedKeys={props.setSelectedKeys}
          selectedKeys={props.selectedKeys}
          confirm={props.confirm}
          clearFilters={props.clearFilters}
        />
      ),
      onFilter: (value: any, record: any) => {
        return !value || record.status === value
      },
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 100,
      render: (_: any, record: any) => (
        <ActionButtons
          itemId={record.id}
          itemName={record.title}
          onView={() => openViewing(record)}
          showEdit={false}
          showDelete={false}
          buttonSize="small"
          type="link"
        />
      ),
    },
  ]
  const columns = columnsAll.filter(c => visibleCols[c.key as string] !== false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Page-level tab switcher */}
      <Tabs
        activeKey={pageTab}
        onChange={k => setPageTab(k as 'events' | 'announcements')}
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'events',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CalendarOutlined style={{ color: '#E7B54A' }} />
                <span
                  style={{
                    backgroundImage: 'linear-gradient(90deg, #FDE08D 0%, #E7B54A 52%, #C48D3A 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    color: 'transparent',
                    fontWeight: 700
                  }}
                >
                  {t('navigation.events', { defaultValue: 'Events' })}
                </span>
              </span>
            ),
          },
          {
            key: 'announcements',
            label: <span><NotificationOutlined /> {t('announcements.management', { defaultValue: 'Announcements' })}</span>,
          },
        ]}
      />

      {pageTab === 'announcements' && <AnnouncementsAdmin />}

      <div
        style={{
          height: isMobile ? '90vh' : 'auto',
          display: pageTab === 'events' ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: isMobile ? 'hidden' : 'visible'
        }}
      >
      <Modal open={orderSyncing} footer={null} closable={false} maskClosable={false} centered>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Spin />
          <span>{t('common.processingOrders')}</span>
        </div>
      </Modal>
      {selectedRowKeys.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0 0' }}>
          <Space>
            <BatchDeleteButton
              selectedIds={selectedRowKeys}
              onBatchDelete={async (ids) => {
                await Promise.all(ids.map(id => updateDocument(COLLECTIONS.EVENTS, id, { status: 'cancelled' })))
                return { success: true }
              }}
              onSuccess={async () => {
                refreshEvents()
                setSelectedRowKeys([])
              }}
              buttonText={t('common.batchCancelled')}
              itemTypeName={t('events.event')}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#FFFFFF'
              }}
            />
            <BatchDeleteButton
              selectedIds={selectedRowKeys}
              onBatchDelete={async (ids) => {
                await Promise.all(ids.map(id => deleteDocument(COLLECTIONS.EVENTS, id)))
                return { success: true }
              }}
              onSuccess={async () => {
                refreshEvents()
                setSelectedRowKeys([])
              }}
              itemTypeName={t('events.event')}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: 'rgba(255, 77, 79, 0.8)',
                border: 'none',
                color: '#FFFFFF',
                fontWeight: 700
              }}
            />
          </Space>
        </div>
      )}

      {/* 搜索和筛选 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(244,175,37,0.2)'
        }}
      >
        <EventSearchBar
          keyword={keyword}
          onKeywordChange={setKeyword}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onReset={() => { setKeyword(''); setStatusFilter(undefined); setSelectedRowKeys([]) }}
          isMobile={isMobile}
        />
      </div>

      {/** 过滤后的数据 */}
      {/* eslint-disable react-hooks/rules-of-hooks */}
      {(() => null)()}
      {/**/}
      
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingTop: 8,
          paddingBottom: 16
        }}
      >
        <button
          type="button"
          onClick={openNewEvent}
          style={{
            width: '100%',
            minHeight: 56,
            marginBottom: 12,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            border: '1px solid rgba(244, 175, 37, 0.5)',
            borderRadius: 8,
            background: 'linear-gradient(90deg, rgba(253, 224, 141, 0.12), rgba(196, 141, 58, 0.06))',
            color: '#FDE08D',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <PlusOutlined style={{ fontSize: 18, color: '#E7B54A' }} />
          <span>{t('eventsAdmin.newEvent', { defaultValue: 'New Event' })}</span>
        </button>

        {!isMobile ? (
          <div className="points-config-form">
          <Table
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            loading={loading || eventsLoading}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              total: events.length,
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total, range) => t('common.paginationTotal', { start: range[0], end: range[1], total }),
            }}
              style={{
                background: 'transparent'
              }}
          />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(ev => (
              <EventCard
                key={ev.id}
                event={ev}
                onView={openViewing}
                getStatusText={getStatusText}
                getStatusColor={getStatusColor}
                completedEvents={completedEvents}
                revenue={revenueMap[ev.id] ?? 0}
                profit={profitMap[ev.id] ?? 0}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>{t('common.noData')}</div>
            )}
          </div>
        )}
      </div>

      {/* 查看活动详情 */}
      <Modal
        title={viewing?.id === 'new' ? t('dashboard.createEvent') : t('events.eventDetails')}
        open={viewingOpen}
        onCancel={() => { closeViewing(); setIsEditingDetails(false) }}
        {...getResponsiveModalConfig(isMobile, true, 1000)}
        style={!isMobile ? { marginLeft: siderOffset } : undefined}
        footer={null}
      >
        {viewing && (
          <Tabs
            className="cigar-equal-tabs"
            activeKey={activeViewTab}
            onChange={(k) => setActiveViewTab(k)}
            tabBarStyle={{
              borderBottom: '1px solid rgba(244,175,37,0.2)',
              marginBottom: 0
            }}
            items={[
              {
                key: 'overview',
                label: t('common.overview'),
                children: (
                  <EventDetailsView
                    event={viewing}
                    isEditing={isEditingDetails}
                    editForm={editForm}
                    onEditFormChange={setEditForm}
                    onSaveField={handleSaveField}
                    onToggleEdit={() => {
                    if (isEditingDetails) {
                      setIsEditingDetails(false)
                      setEditForm({})
                    } else {
                      setIsEditingDetails(true)
                      setEditForm({
                        title: viewing.title,
                        description: (viewing as any).description || '',
                        status: viewing.status,
                        startDate: (() => {
                          const startDate = (viewing as any)?.schedule?.startDate
                          if (!startDate) return null
                          // 处理 Firestore Timestamp
                          if (startDate.toDate && typeof startDate.toDate === 'function') {
                            return dayjs(startDate.toDate())
                          }
                          // 处理 Date 对象
                          if (startDate instanceof Date) {
                            return dayjs(startDate)
                          }
                          // 处理其他格式
                          return dayjs(startDate)
                        })(),
                        endDate: (() => {
                          const endDate = (viewing as any)?.schedule?.endDate
                          if (!endDate) return null
                          // 处理 Firestore Timestamp
                          if (endDate.toDate && typeof endDate.toDate === 'function') {
                            return dayjs(endDate.toDate())
                          }
                          // 处理 Date 对象
                          if (endDate instanceof Date) {
                            return dayjs(endDate)
                          }
                          // 处理其他格式
                          return dayjs(endDate)
                        })(),
                        locationName: (viewing as any)?.location?.name || '',
                        fee: (viewing as any)?.participants?.fee ?? 0,
                        maxParticipants: (viewing as any)?.participants?.maxParticipants ?? 0,
                        isPrivate: !!(viewing as any)?.isPrivate,
                      })
                    }
                  }}
                    onDelete={() => {
                    closeViewing()
                    setDeleting(viewing)
                  }}
                    onImageChange={async (url) => {
                      if (viewing?.id === 'new') {
                        setEditForm({...editForm, image: url})
                                      } else {
                        try {
                          const updateData = { image: url, updatedAt: new Date() }
                          const res = await updateDocument(COLLECTIONS.EVENTS, viewing.id, updateData)
                          if (res.success) {
                            message.success(t('common.saved'))
                            refreshEvents()
                            const updatedEvent = await getEventById(viewing.id)
                            if (updatedEvent) {
                              openViewing(updatedEvent as Event)
                            }
                                    } else {
                            message.error(t('common.saveFailed'))
                          }
                        } catch (error) {
                          message.error(t('common.saveFailed'))
                        }
                      }
                    }}
                  />
                ),
              },
              {
                key: 'participants',
                label: t('common.participantsManagement'),
                children: (
                  <EventParticipantsManager
                    event={viewing}
                              participantsUsers={participantsUsers}
                              cigars={cigars}
                              onEventUpdate={(updatedEvent) => {
                                openViewing(updatedEvent)
                                refreshEvents()
                              }}
                              getCigarPriceById={getCigarPriceById}
                              getCigarCostById={getCigarCostById}
                            />
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* 参与者弹窗：查看/导出/导入/雪茄分配 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('common.participantsManagement')}</span>
            <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)',marginRight: 30 }}>
              {t('common.registered')}：{((participantsEvent as any)?.participants?.registered || []).length} / {(participantsEvent as any)?.participants?.maxParticipants || 0}
            </div>
          </div>
        }
        open={!!participantsEvent}
        onCancel={() => setParticipantsEvent(null)}
        footer={null}
        width={900}
      >
        <div style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
                    <Select
              showSearch
              allowClear
              placeholder={t('common.pleaseInputNameEmailPhoneOrUserId')}
              style={{ width: '100%' }}
              value={manualAddValue || undefined}
              onSearch={(val) => setManualAddValue(val)}
              onChange={(val) => setManualAddValue(val || '')}
              onSelect={(val) => setManualAddValue(String(val))}
              filterOption={(input, option) => {
                const keyword = (input || '').toLowerCase()
                const searchable = String((option as any)?.searchText || '').toLowerCase()
                return searchable.includes(keyword)
              }}
               notFoundContent={manualAddValue && manualAddValue.trim() !== '' ? t('common.noMatch') : t('common.noData')}
                options={(manualAddValue && manualAddValue.trim() !== '' ? participantsUsers : []).map(u => ({
                  value: u.id,
                  // 用于搜索匹配的纯文本字段
                  searchText: `${u.displayName || ''} ${(u as any)?.profile?.phone || ''} ${u.email || ''} ${u.id}`.trim(),
                  label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ flex: 1, textAlign: 'left' }}>{u.displayName || t('common.unnamed')}</span>
                      <span style={{ flex: 2, textAlign: 'left', color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>
                        {(u as any)?.profile?.phone || t('common.noPhone')}
                      </span>
                      <span style={{ flex: 6, textAlign: 'left', color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>
                        {u.email || t('common.noEmail')}
                      </span>
          </div>
                )
                }))}
            />
            <Button type="primary" loading={manualAddLoading} onClick={async () => {
              if (!participantsEvent) return
              const raw = manualAddValue.trim()
              if (!raw) return
              setManualAddLoading(true)
              try {
                let userId = raw
                const byId = participantsUsers.find(u => u.id === raw)
                if (!byId) {
                  if (raw.includes('@')) {
                    const match = participantsUsers.find(u => u.email?.toLowerCase() === raw.toLowerCase())
                    if (!match) { message.error(t('common.userNotFound')); return }
                  userId = match.id
                  } else if (/^\+?\d[\d\s-]{5,}$/.test(raw)) {
                    const match = participantsUsers.find(u => ((u as any)?.profile?.phone || '').replace(/\s|-/g,'') === raw.replace(/\s|-/g,''))
                    if (!match) { message.error(t('common.userNotFound')); return }
                    userId = match.id
                  } else {
                    const matches = participantsUsers.filter(u => (u.displayName || '').toLowerCase().includes(raw.toLowerCase()))
                    if (matches.length === 1) userId = matches[0].id
                    else { message.info(t('common.pleaseSelectUniqueUser')); return }
                  }
                }
                const res = await registerForEvent((participantsEvent as any).id, userId)
                if (res.success) {
                  message.success(t('common.participantAdded'));
                  refreshEvents()
                  const refreshedEvent = await getEventById((participantsEvent as any).id)
                  setParticipantsEvent(refreshedEvent as any || null)
                  setManualAddValue('')
                } else {
                  message.error(t('common.addFailed'));
                }
              } finally {
                setManualAddLoading(false)
              }
            }}>{t('common.add')}</Button>
          </Space.Compact>
          </div>

        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button 
              icon={<CheckCircleOutlined />}
              type="primary"
              onClick={async () => {
              if (!participantsEvent) return
                setOrderSyncing(true)
                const orderResult = await createOrdersFromEventAllocations((participantsEvent as any).id);
                if (orderResult.success) {
                  const totalOrders = orderResult.createdOrders + orderResult.updatedOrders;
                  if (totalOrders > 0) {
                    let messageText = '';
                    if (orderResult.createdOrders > 0 && orderResult.updatedOrders > 0) {
                      messageText = `${orderResult.createdOrders} ${t('common.ordersCreated')}, ${orderResult.updatedOrders} ${t('common.ordersUpdated')} ${t('common.forEvent')}`;
                    } else if (orderResult.createdOrders > 0) {
                      messageText = `${t('common.ordersCreated')} ${orderResult.createdOrders} ${t('common.forEvent')}`;
                    } else if (orderResult.updatedOrders > 0) {
                      messageText = `${t('common.ordersUpdated')} ${orderResult.updatedOrders} ${t('common.forEvent')}`;
                    }
                    message.success(messageText);
                    // 订单创建/更新后，刷新活动数据以更新参与者列表的订单状态与ID
                    try {
                      const refreshed = await getEventById((participantsEvent as any).id)
                      if (refreshed) {
                        setParticipantsEvent(refreshed as any)
                      }
                    } catch {}
                  } else {
                    message.info(t('common.noParticipantsAssignedCigars'));
                  }
                } else {
                  message.error(t('common.createOrdersFailed') + ' ' + (orderResult.error?.message || t('common.unknownError')));
                }
                setOrderSyncing(false)
              }}
            >
              {t('common.createOrders')}
            </Button>
            <Button 
              icon={<DownloadOutlined />}
              onClick={() => {
              if (!participantsEvent) return
                const header = ['userId','displayName','phone','email','cigarName','quantity','amount']
              const rows = (((participantsEvent as any)?.participants?.registered || []) as string[]).map((id) => {
                const u = participantsUsers.find(x => x.id === id)
                  const alloc = (participantsEvent as any)?.allocations?.[id]
                  const cigar = cigars.find(c => c.id === alloc?.cigarId)
                  return [
                    id, 
                    u?.displayName || '', 
                    (u as any)?.profile?.phone || '',
                    u?.email || '',
                    cigar?.name || '',
                    alloc?.quantity || 0,
                    alloc?.amount || 0
                  ]
              })
              const csv = [header.join(','), ...rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(','))].join('\n')
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
                a.download = `participants-${(participantsEvent as any)?.title || 'event'}.csv`
              a.click()
              URL.revokeObjectURL(url)
              }}
            >
              {t('common.exportAllocations')}
            </Button>
            <Upload
              accept=".csv"
              beforeUpload={async (file) => {
                if (!participantsEvent) return false
                const text = await file.text()
                const lines = text.split(/\r?\n/).filter(Boolean)
                const ids = lines.slice(1).map(l => l.split(',')[0].replace(/(^\"|\"$)/g,'')).filter(Boolean)
                const uniq = Array.from(new Set(ids))
                const merged = Array.from(new Set([...(participantsEvent as any)?.participants?.registered || [], ...uniq]))
                await updateDocument(COLLECTIONS.EVENTS, (participantsEvent as any).id, { 'participants.registered': merged } as any)
                message.success(`${t('common.imported')} ${uniq.length} ${t('common.条')}`);
                refreshEvents()
                const refreshedEvent = await getEventById((participantsEvent as any).id)
                setParticipantsEvent(refreshedEvent as any || null)
                return false
              }}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>{t('common.importParticipants')}</Button>
            </Upload>
          </Space>
        </div>

        <div style={{ 
          maxHeight: 400, 
          overflow: 'hidden', 
          border: '1px solid rgba(244, 175, 37, 0.6)', 
          borderRadius: 12,
          background: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(10px)'
        }}>
          <ParticipantsList
            event={participantsEvent}
            participantsUsers={participantsUsers}
            cigars={cigars}
            participantsLoading={participantsLoading}
            allocSaving={allocSaving}
            onEventUpdate={(updatedEvent) => {
              setParticipantsEvent(updatedEvent)
              refreshEvents()
            }}
            onAllocSavingChange={setAllocSaving}
            getCigarPriceById={getCigarPriceById}
          />
        </div>

        <ParticipantsSummary
          event={participantsEvent}
          getCigarPriceById={getCigarPriceById}
          getCigarCostById={getCigarCostById}
          onEventUpdate={(updatedEvent) => {
            setParticipantsEvent(updatedEvent)
            refreshEvents()
          }}
        />
      </Modal>

      {/* 创建/编辑 弹窗 */}
      <Modal
        title={editing ? t('common.edit') : t('common.add')}
        open={creating || editingOpen}
        onCancel={() => {
          setCreating(false)
          closeEditing()
          form.resetFields()
        }}
        {...getResponsiveModalConfig(isMobile, true, 720)}
        style={!isMobile ? { marginLeft: siderOffset } : undefined}
        footer={[
          <button 
            key="cancel" 
            type="button" 
            onClick={() => {
              setCreating(false)
              closeEditing()
              form.resetFields()
            }}
            style={{ 
              padding: '6px 14px', 
              borderRadius: 8, 
              border: '1px solid rgba(255, 255, 255, 0.2)', 
              background: 'rgba(255, 255, 255, 0.05)', 
              color: '#fff',
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
              form.submit()
            }} 
            style={{ 
              padding: '6px 14px', 
              borderRadius: 8, 
              cursor: 'pointer' 
            }}
          >
            {editing ? t('common.save') : t('common.create')}
          </button>
        ]}
      >
        <Form form={form} layout="vertical" onFinish={async (values: any) => {
          
          setLoading(true)
          try {
            // ===== STATUS VALIDATION AND PROCESSING =====
            const currentStatus = editing?.status || DEFAULT_STATUS
            const newStatus = values.status || DEFAULT_STATUS
            
            
            // Validate status transition
            if (editing && !isValidStatusTransition(currentStatus, newStatus)) {
              message.error(t('common.invalidStatusTransition'))
              return
            }
            
            // Calculate auto-status based on dates if not manually set
            const finalStatus = newStatus === DEFAULT_STATUS ? 
              calculateEventStatus({ ...editing, schedule: { 
                startDate: toDateOrNull(values.startDate), 
                endDate: toDateOrNull(values.endDate),
                registrationDeadline: toDateOrNull(values.endDate)
              } } as Event) : newStatus

            const payload: Partial<Event> = {
              title: values.title,
              description: values.description,
              location: { name: values.locationName, address: '' },
              schedule: { 
                startDate: toDateOrNull(values.startDate), 
                endDate: toDateOrNull(values.endDate), 
                registrationDeadline: toDateOrNull(values.endDate) 
              },
              participants: { 
                fee: values.fee ?? DEFAULT_FEE, 
                maxParticipants: values.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS, 
                registered: (editing as any)?.participants?.registered || [] 
              },
              isPrivate: !!values.isPrivate,
              status: finalStatus,
              updatedAt: new Date(),
            } as any
            
            
            if (editing) {
              const res = await updateDocument<Event>(COLLECTIONS.EVENTS, editing.id, payload)
              if (res.success) {
                // Auto-create orders when status is set to "completed"
                if (finalStatus === EVENT_STATUSES.COMPLETED && editing.status !== EVENT_STATUSES.COMPLETED) {
                  setOrderSyncing(true)
                  const orderResult = await createOrdersFromEventAllocations(editing.id);
                  if (orderResult.success) {
                    const totalOrders = orderResult.createdOrders + orderResult.updatedOrders;
                    if (totalOrders > 0) {
                      let messageText = t('common.eventSavedAndEnded');
                    if (orderResult.createdOrders > 0) {
                        messageText += ` ${orderResult.createdOrders} ${t('common.ordersCreated')}`;
                      }
                      if (orderResult.updatedOrders > 0) {
                        messageText += ` ${orderResult.updatedOrders} ${t('common.ordersUpdated')}`;
                      }
                      message.success(messageText);
                    } else {
                      message.success(t('common.eventSavedAndEnded'));
                    }
                  } else {
                    message.warning(t('common.eventSavedAndEnded') + ' ' + (orderResult.error?.message || t('common.unknownError')));
                  }
                  setOrderSyncing(false)
                } else {
                  message.success(t('common.saved'))
                }
              }
            } else {
              const result = await createDocument<Event>(COLLECTIONS.EVENTS, { ...payload, createdAt: new Date() } as any)
              
              message.success(t('common.created'))
            }
            
            refreshEvents()
            setCreating(false)
            closeEditing()

          } finally {
            setLoading(false)
          }
        }}>
          <div style={{ width: '100%', overflow: 'hidden' }}>
            {/* 基本信息卡片 */}
            <div style={theme.card.elevated}>
              <div style={theme.text.subtitle}>
                {t('events.basicInfo')}
              </div>
              
              <Form.Item 
                label={t('common.eventName')} 
                name="title" 
                rules={[{ required: true, message: t('common.pleaseInputEventName') }]}
                style={{ marginBottom: 12 }}
              >
                <Input placeholder={t('events.namePlaceholder')} />
          </Form.Item>
              
              <Form.Item 
                label={t('common.description')} 
                name="description"
                style={{ marginBottom: 12 }}
              >
                <Input.TextArea rows={2} placeholder={t('events.descriptionPlaceholder')} />
          </Form.Item>
              
              <Form.Item 
                label={t('common.locationName')} 
                name="locationName" 
                rules={[{ required: true, message: t('common.pleaseInputLocationName') }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder={t('events.locationPlaceholder')} />
          </Form.Item>
            </div>
            
            {/* 时间设置卡片 */}
            <div style={theme.card.elevated}>
              <div style={theme.text.subtitle}>
                {t('events.timeSettings')}
              </div>
              
          <Form.Item 
            label={t('common.startDate')} 
            name="startDate" 
            rules={[
              { required: true, message: t('common.pleaseSelectStartDate') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const endDate = getFieldValue('endDate')
                  if (value && endDate && dayjs(value).isAfter(dayjs(endDate))) {
                    return Promise.reject(new Error(t('common.startDateCannotBeAfterEndDate')))
                  }
                  return Promise.resolve()
                }
              })
            ]}
                style={{ marginBottom: 12 }}
          >
            <DatePicker 
              style={{ width: '100%' }} 
              disabledDate={(current) => current && current < dayjs().startOf('day')}
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder={t('common.pleaseSelectStartDate')}
            />
          </Form.Item>
              
          <Form.Item 
            label={t('common.endDate')} 
            name="endDate" 
            rules={[
              { required: true, message: t('common.pleaseSelectEndDate') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const startDate = getFieldValue('startDate')
                  if (value && startDate && dayjs(value).isBefore(dayjs(startDate))) {
                    return Promise.reject(new Error(t('common.endDateCannotBeBeforeStartDate')))
                  }
                  return Promise.resolve()
                }
              })
            ]}
                style={{ marginBottom: 0 }}
          >
            <DatePicker 
              style={{ width: '100%' }} 
              disabledDate={(current) => current && current < dayjs().startOf('day')}
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder={t('common.pleaseSelectEndDate')}
            />
          </Form.Item>
            </div>
            
            {/* 参与设置卡片 */}
            <div style={theme.card.elevated}>
              <div style={theme.text.subtitle}>
                {t('events.participationSettings')}
              </div>
              
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item 
                    label={t('common.fee')} 
                    name="fee"
                    style={{ marginBottom: 12 }}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} placeholder={t('events.feePlaceholder')} controls={false} />
          </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item 
                    label={t('common.maxParticipants')} 
                    name="maxParticipants"
                    style={{ marginBottom: 12 }}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} placeholder={t('events.maxParticipantsPlaceholder')} controls={false} />
          </Form.Item>
                </Col>
              </Row>
              
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item 
                    label={t('common.privateEvent')} 
                    name="isPrivate" 
                    valuePropName="checked" 
                    initialValue={false}
                    style={{ marginBottom: 0 }}
                  >
            <Switch />
          </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item 
                    label={t('common.status')} 
                    name="status" 
                    initialValue={DEFAULT_STATUS}
                    style={{ marginBottom: 0 }}
                  >
            <Select>
              {(() => {
                const currentStatus = editing?.status || DEFAULT_STATUS
                const availableStatuses = editing ? getAvailableStatusOptions(currentStatus) : Object.values(EVENT_STATUSES)
                
                return availableStatuses.map(status => (
                  <Option key={status} value={status}>
                    {t(`common.${status}`)}
                    {status === currentStatus && ` (${t('common.current')})`}
                  </Option>
                ))
              })()}
            </Select>
          </Form.Item>
                </Col>
              </Row>
            </div>
            
            {/* 图片上传卡片 */}
            {!isMobile && (
              <div style={theme.card.elevated}>
                <div style={theme.text.subtitle}>
                  {t('events.eventImages')}
                </div>
                
                <Form.Item 
                  name="image"
                  style={{ marginBottom: 0 }}
                >
                  <ImageUpload
                    folder="events"
                    showPreview={true}
                    onChange={(url) => {
                    }}
                  />
                </Form.Item>
              </div>
            )}
          </div>
        </Form>
      </Modal>

      {/* 删除确认 */}
      <Modal
        title={t('common.deleteEvent')}
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onOk={async () => {
          if (!deleting) return
          setLoading(true)
          try {
            const res = await deleteDocument(COLLECTIONS.EVENTS, deleting.id)
            if (res.success) {
              message.success(t('common.deleted'))
              refreshEvents()
            }
          } finally {
            setLoading(false)
            setDeleting(null)
          }
        }}
        okButtonProps={{ danger: true }}
      >
        {t('common.confirmDeleteEvent')} {deleting?.title}？{t('common.thisOperationCannotBeUndone')}
      </Modal>
      </div>
    </div>
  )
}

export default AdminEvents
