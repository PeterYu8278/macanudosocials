// Common User Profile View Component
import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Row, Col, Card, Typography, Tag, Button, Space, Spin, App, Drawer } from 'antd'
import {
  CalendarOutlined,
  ShoppingOutlined,
  TrophyOutlined,
  UserOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  NumberOutlined
} from '@ant-design/icons'

const { Text } = Typography

import { getEventsByUser, getOrdersByUser, getCigarById, getReferredUsers, getDocument } from '../../services/firebase/firestore'
import { collection, getDocs, query, limit } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { getUserPointsRecords } from '../../services/firebase/pointsRecords'
import { getUserVisitSessions } from '../../services/firebase/visitSessions'
import { getTotalRedemptions } from '../../services/firebase/redemption'
import type { User, Event, Order, Cigar, PointsRecord, RedemptionRecord, VisitSession } from '../../types'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MemberProfileCard } from './MemberProfileCard'
import { CigarRedemptionDrawer } from './CigarRedemptionDrawer'
import { groupCigarRedemptions, type CigarRedemptionGroup } from '../../utils/cigarRedemptionGroups'
import { isFeatureVisible } from '../../services/firebase/featureVisibility'
import { useAuthStore } from '../../store/modules/auth'
import { textTransform } from 'html2canvas/dist/types/css/property-descriptors/text-transform'
import { formatPointsRecordDescription, isHistoricalPointsRecord, isVisitDurationRecord } from '../../utils/pointsRecordDisplay'

interface ProfileViewProps {
  active?: boolean
  closing?: boolean
  onCloseComplete?: () => void
  detailDrawerWidth?: number
  user?: User | null          // Direct user object
  userId?: string              // Or User ID (loaded internally)
  readOnly?: boolean           // Read-only mode
  showEditButton?: boolean     // Show edit button
  onEdit?: (user: User) => void // Edit callback
  onLogout?: () => void        // Logout callback
}

const summarizeVisitRedemptions = (session: VisitSession | null) => {
  const totals = new Map<string, { cigarId: string; cigarName: string; quantity: number }>()

  for (const redemption of session?.redemptions || []) {
    const key = redemption.cigarId || redemption.cigarName
    const existing = totals.get(key)
    totals.set(key, {
      cigarId: redemption.cigarId,
      cigarName: redemption.cigarName,
      quantity: (existing?.quantity || 0) + Number(redemption.quantity || 0),
    })
  }

  return [...totals.values()]
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  active = true,
  closing = false,
  onCloseComplete,
  detailDrawerWidth,
  user: propUser,
  userId: propUserId,
  readOnly = false,
  showEditButton = false,
  onEdit,
  onLogout
}) => {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const { user: authUser } = useAuthStore()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(propUser || null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [showMemberCard, setShowMemberCard] = useState(false)
  const [activeTab, setActiveTab] = useState<'cigar' | 'points' | 'activity' | 'referral'>('cigar')
  const [eventsFeatureVisible, setEventsFeatureVisible] = useState<boolean>(true)
  const [aiCigarHistoryVisible, setAiCigarHistoryVisible] = useState<boolean>(true)
  const [userEvents, setUserEvents] = useState<Event[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [userVisitSessions, setUserVisitSessions] = useState<VisitSession[]>([])
  const [loadingVisitSessions, setLoadingVisitSessions] = useState(false)
  const [userOrders, setUserOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [userRedemptions, setUserRedemptions] = useState<RedemptionRecord[]>([])
  const [selectedCigarGroup, setSelectedCigarGroup] = useState<CigarRedemptionGroup | null>(null)
  const [loadingRedemptions, setLoadingRedemptions] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [cigarRecordDrawerOpen, setCigarRecordDrawerOpen] = useState(false)
  const [referredUsers, setReferredUsers] = useState<User[]>([])
  const [loadingReferrals, setLoadingReferrals] = useState(false)
  const [pointsRecords, setPointsRecords] = useState<PointsRecord[]>([])
  const [selectedPointsRecord, setSelectedPointsRecord] = useState<PointsRecord | null>(null)
  const [pointsRecordReviewer, setPointsRecordReviewer] = useState<{ id?: string; name?: string }>({})
  const [selectedVisitSession, setSelectedVisitSession] = useState<VisitSession | null>(null)
  const [pointsRecordDrawerOpen, setPointsRecordDrawerOpen] = useState(false)
  const pendingDrawerClosures = useRef(new Set<string>())
  const closeComplete = useRef(onCloseComplete)
  closeComplete.current = onCloseComplete
  useEffect(() => {
    if (!closing) return
    pendingDrawerClosures.current = new Set([
      ...(selectedCigarGroup ? ['group'] : []),
      ...(cigarRecordDrawerOpen ? ['cigar'] : []),
      ...(pointsRecordDrawerOpen ? ['points'] : []),
    ])
    if (pendingDrawerClosures.current.size === 0) closeComplete.current?.()
  }, [closing])
  const onDrawerOpenChange = (drawer: string, open: boolean) => {
    if (open || !closing || !pendingDrawerClosures.current.delete(drawer)) return
    if (pendingDrawerClosures.current.size === 0) closeComplete.current?.()
  }
  useEffect(() => {
    setSelectedCigarGroup(null)
    setCigarRecordDrawerOpen(false)
    setPointsRecordDrawerOpen(false)
    setSelectedOrder(null)
    setSelectedPointsRecord(null)
    setSelectedVisitSession(null)
    setShowMemberCard(false)
  }, [active, propUser?.id, propUserId])
  const [loadingPointsRecordDetails, setLoadingPointsRecordDetails] = useState(false)
  const canViewDiscount = authUser?.role === 'developer' || authUser?.role === 'superAdmin'
  const [loadingPointsRecords, setLoadingPointsRecords] = useState(false)
  const [pointsVisitSessions, setPointsVisitSessions] = useState<Record<string, VisitSession>>({})
  const [referralActivationMap, setReferralActivationMap] = useState<Record<string, Date | null>>({})
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  )
  useEffect(() => {
    let active = true
    setPointsRecordReviewer({})
    if (!selectedPointsRecord || !pointsRecordDrawerOpen) return

    const loadReviewer = async () => {
      let reviewerId = selectedPointsRecord.createdBy
      let reviewerName: string | undefined
      if (selectedPointsRecord.source === 'reload' && selectedPointsRecord.relatedId) {
        try {
          const reload = await getDocument('reloadRecords', selectedPointsRecord.relatedId) as {
            verifiedBy?: string; verifiedByName?: string
          } | null
          reviewerId = reload?.verifiedBy || reviewerId
          reviewerName = reload?.verifiedByName?.trim() || undefined
        } catch (error) {
          console.error('[ProfileView] Failed to load reload reviewer:', error)
        }
      }
      if (reviewerId && reviewerId !== 'system' && !reviewerName) {
        try {
          const reviewer = await getDocument('users', reviewerId) as User | null
          reviewerName = reviewer?.displayName
        } catch (error) {
          console.error('[ProfileView] Failed to load points record reviewer:', error)
        }
      }
      if (active) setPointsRecordReviewer({ id: reviewerId, name: reviewerName })
    }
    void loadReviewer()
    return () => { active = false }
  }, [selectedPointsRecord, pointsRecordDrawerOpen])
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Load user data if userId is provided
  useEffect(() => {
    if (propUserId && !propUser) {
      const loadUser = async () => {
        setLoadingUser(true)
        try {
          const userData = await getDocument('users', propUserId) as User
          if (userData) {
            setUser({ ...userData, id: propUserId })
          }
        } catch (error) {
          console.error('Error loading user:', error)
        } finally {
          setLoadingUser(false)
        }
      }
      loadUser()
    }
  }, [propUserId, propUser])

  // Update user when propUser changes
  useEffect(() => {
    if (propUser) {
      setUser(propUser)
    }
  }, [propUser])

  // Check feature visibility (developer always allowed)
  useEffect(() => {
    const checkFeatureVisibility = async () => {
      const isDev = authUser?.role === 'developer'
      const eventsVisible = isDev ? true : await isFeatureVisible('events')
      setEventsFeatureVisible(eventsVisible)
      if (!eventsVisible && activeTab === 'activity') setActiveTab('cigar')

      const aiVisible = isDev ? true : await isFeatureVisible('ai-cigar-history')
      setAiCigarHistoryVisible(aiVisible)
    }
    checkFeatureVisibility()
  }, []) // Check once on mount

  // Switch tab if feature hidden while active
  useEffect(() => {
    if (!eventsFeatureVisible && activeTab === 'activity') {
      setActiveTab('cigar')
    }
  }, [eventsFeatureVisible, activeTab])

  // Load joined events
  useEffect(() => {
    const loadUserEvents = async () => {
      if (!user?.id) return
      setLoadingEvents(true)
      try {
        const events = await getEventsByUser(user.id)
        setUserEvents(events)
      } catch (error) {
        console.error('Error loading events:', error)
      } finally {
        setLoadingEvents(false)
      }
    }
    loadUserEvents()
  }, [user?.id])

  // Redemption records are the canonical source for cigars savoured, including legacy imports.
  useEffect(() => {
    const loadUserRedemptions = async () => {
      if (!user?.id) {
        setUserRedemptions([])
        return
      }
      setLoadingRedemptions(true)
      try {
        const records = await getTotalRedemptions(user.id)
        setUserRedemptions(records.sort((a, b) => b.redeemedAt.getTime() - a.redeemedAt.getTime()))
      } catch (error) {
        console.error('[ProfileView] Failed to load redemption records:', error)
        setUserRedemptions([])
      } finally {
        setLoadingRedemptions(false)
      }
    }
    loadUserRedemptions()
  }, [user?.id])

  // Load lounge visits for the Activity Records tab.
  useEffect(() => {
    const loadUserVisitSessions = async () => {
      if (!user?.id) {
        setUserVisitSessions([])
        return
      }
      setLoadingVisitSessions(true)
      try {
        setUserVisitSessions(await getUserVisitSessions(user.id, 200))
      } catch (error) {
        console.error('[ProfileView] Failed to load visit sessions:', error)
        setUserVisitSessions([])
      } finally {
        setLoadingVisitSessions(false)
      }
    }
    loadUserVisitSessions()
  }, [user?.id])

  // Load orders and fill cigar names
  useEffect(() => {
    const loadUserOrders = async () => {
      if (!user?.id) return
      setLoadingOrders(true)
      try {
        const orders = await getOrdersByUser(user.id)
        const cigarIds = [...new Set(orders.flatMap(o => o.items.map(i => i.cigarId)).filter(Boolean))]
        const cigarDocs = await Promise.all(cigarIds.map(id => getCigarById(id)))
        const cigarMap = new Map(cigarDocs.filter(Boolean).map(c => [c!.id, c!.name]))

        // Fill cigar names for each item
        const ordersWithNames = orders.map(order => ({
          ...order,
          items: order.items.map(item => ({
            ...item,
            name: item.name || cigarMap.get(item.cigarId) || item.cigarId
          }))
        }))

        setUserOrders(ordersWithNames)
      } catch (error) {
        console.error('Error loading orders:', error)
      } finally {
        setLoadingOrders(false)
      }
    }
    loadUserOrders()
  }, [user?.id])

  // Load referred users
  useEffect(() => {
    const loadReferredUsers = async () => {
      if (!user?.id) {
        setReferredUsers([])
        return
      }

      setLoadingReferrals(true)
      try {
        const referred = await getReferredUsers(user.id)
        const referralsSnapshot = await getDocs(query(
          collection(db, 'users', user.id, 'referrals'),
          limit(200)
        ))
        const knownIds = new Set(referred.map(entry => entry.id))
        const unknownReferrals = referralsSnapshot.docs
          .filter(referralDoc => referralDoc.data().isPlaceholder === true && !knownIds.has(referralDoc.id))
          .map((referralDoc, index) => {
            const data = referralDoc.data()
            const placeholderIndex = Number(data.placeholderIndex || index + 1)
            const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt || Date.now())
            return {
              id: referralDoc.id,
              displayName: String(data.referredUserName || '').trim()
                || t('profile.unknownReferral', { index: placeholderIndex, defaultValue: `Unknown Person ${placeholderIndex}` }),
              email: '',
              role: 'guest',
              status: 'active',
              profile: {},
              membership: { level: 'bronze' },
              referral: { referrals: [], totalReferred: 0, activeReferrals: 0 },
              createdAt,
              updatedAt: data.updatedAt?.toDate?.() || createdAt,
              isReferralPlaceholder: true,
            } as unknown as User
          })
        referred.push(...unknownReferrals)
        // Sort by join date descending
        referred.sort((a, b) => {
          const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt)
          const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt)
          return dateB.getTime() - dateA.getTime()
        })
        setReferredUsers(referred)
      } catch (error) {
        console.error('Error loading referrals:', error)
      } finally {
        setLoadingReferrals(false)
      }
    }
    loadReferredUsers()

    // Load membershipActivatedAt from referrals subcollection
    const loadReferralActivations = async () => {
      if (!user?.id) return
      try {
        const referralsRef = collection(db, 'users', user.id, 'referrals')
        const snap = await getDocs(query(referralsRef, limit(200)))
        const map: Record<string, Date | null> = {}
        snap.docs.forEach(docSnap => {
          const data = docSnap.data()
          const activatedAt = data.membershipActivatedAt
          if (activatedAt) {
            map[docSnap.id] = activatedAt?.toDate?.() || (activatedAt instanceof Date ? activatedAt : new Date(activatedAt))
          } else {
            map[docSnap.id] = null
          }
        })
        setReferralActivationMap(map)
      } catch (error) {
        console.error('[ProfileView] Failed to load referral activations:', error)
      }
    }
    loadReferralActivations()
  }, [user?.id, t])

  // Load points records
  useEffect(() => {
    const loadPointsRecords = async () => {
      if (!user?.id) {
        setPointsRecords([])
        return
      }

      setLoadingPointsRecords(true)
      try {
        const records = await getUserPointsRecords(user.id, 50)
        setPointsRecords(records)

        const visitSessionIds = [...new Set(
          records
            .filter(record => isVisitDurationRecord(record) && record.relatedId)
            .map(record => record.relatedId as string)
        )]
        const visitSessions = await Promise.all(
          visitSessionIds.map(async sessionId => {
            const data = await getDocument('visitSessions', sessionId) as any
            if (!data) return null
            const toDate = (value: any) => value?.toDate?.() || (value ? new Date(value) : undefined)
            return {
              id: sessionId,
              ...data,
              checkInAt: toDate(data.checkInAt),
              checkOutAt: toDate(data.checkOutAt),
              createdAt: toDate(data.createdAt),
              updatedAt: toDate(data.updatedAt)
            } as VisitSession
          })
        )
        setPointsVisitSessions(Object.fromEntries(
          visitSessions.filter((session): session is VisitSession => Boolean(session)).map(session => [session.id, session])
        ))
      } catch (error) {
        console.error('[ProfileView] Failed to load points records:', error)
        message.error(t('pointsConfig.loadRecordsFailed'))
        setPointsRecords([])
        setPointsVisitSessions({})
      } finally {
        setLoadingPointsRecords(false)
      }
    }
    loadPointsRecords()
  }, [user?.id, t])

  // Date formatting helper
  const formatDate = (date: Date) => {
    if (i18n.language === 'en-US') {
      const day = date.getDate();
      const month = date.toLocaleDateString('en-US', { month: 'short' });
      const year = date.getFullYear();
      return `${day} ${month}, ${year}`;
    }
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  const totalCigarsSavoured = useMemo(() => (
    userRedemptions
      .filter(record => record.status === 'completed')
      .reduce((total, record) => total + Number(record.quantity || 0), 0)
  ), [userRedemptions])

  const purchaseOrders = useMemo(() => userOrders.filter(order => (
    !order.source?.note?.startsWith('驻店兑换订单 (Session:')
  )), [userOrders])
  const cigarGroups = useMemo(() => groupCigarRedemptions(userRedemptions), [userRedemptions])

  const formatHoursMinutes = (hoursValue: unknown, minutesValue?: unknown) => {
    const explicitMinutes = Number(minutesValue)
    const hours = Number(hoursValue)
    const totalMinutes = Number.isFinite(explicitMinutes) && minutesValue !== undefined
      ? Math.max(0, Math.floor(explicitMinutes))
      : Math.max(0, Math.floor((Number.isFinite(hours) ? hours : 0) * 60 + 0.000001))
    return t('profile.hoursMinutes', {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      defaultValue: `${Math.floor(totalMinutes / 60)} H ${totalMinutes % 60}m`,
    })
  }

  const totalVisitHours = Number(user?.membership?.totalVisitHours || 0)
  const totalLoungeHours = t('profile.hoursOnly', {
    hours: Math.max(0, Math.floor(Number.isFinite(totalVisitHours) ? totalVisitHours : 0)),
    defaultValue: '{{hours}} H',
  })

  // User stats data
  const isChinese = i18n.language.startsWith('zh')
  const userStats = [
    { title: t('profile.eventsJoined'), value: userEvents.length, icon: <CalendarOutlined /> },
    {
      title: t('profile.cigarsSavoured', { defaultValue: isChinese ? '品鉴雪茄' : 'Cigars Savoured' }),
      value: totalCigarsSavoured,
      icon: <ShoppingOutlined />,
    },
    { title: t('profile.communityPoints'), value: (user?.membership as any)?.points || 0, icon: <TrophyOutlined /> },
    {
      title: t('profile.loungeHours', { defaultValue: isChinese ? '驻店时长' : 'Lounge Hours' }),
      value: totalLoungeHours,
      icon: <ClockCircleOutlined />,
    },
  ]

  const getStatTitleLines = (title: string) => {
    if (!isMobile) return [title]
    const words = title.trim().split(/\s+/)
    if (words.length > 1) {
      const midpoint = Math.ceil(words.length / 2)
      return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')]
    }
    const midpoint = Math.ceil(title.length / 2)
    return [title.slice(0, midpoint), title.slice(midpoint)]
  }

  const getMembershipColor = (level: string) => {
    switch (level) {
      case 'bronze': return 'default'
      case 'silver': return 'default'
      case 'gold': return '#faad14'
      case 'platinum': return '#722ed1'
      default: return 'default'
    }
  }

  const getMembershipText = (level: string) => {
    switch (level) {
      case 'bronze': return t('profile.bronzeMember')
      case 'silver': return t('profile.silverMember')
      case 'gold': return t('profile.goldMember')
      case 'platinum': return t('profile.platinumMember')
      default: return t('profile.regularMember')
    }
  }

  if (loadingUser) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255, 255, 255, 0.6)' }}>
        <p>{t('usersAdmin.userNotFound')}</p>
      </div>
    )
  }

  const toDateValue = (value: any): Date | null => {
    if (!value) return null
    const date = value instanceof Date ? value : value?.toDate?.() || new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const formatDateTime = (value: any): string => {
    const date = toDateValue(value)
    if (!date) return '-'
    return isChinese
      ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      : `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }

  const formatVisitPeriod = (session?: VisitSession): string | null => {
    const checkIn = toDateValue(session?.checkInAt)
    const checkOut = toDateValue(session?.checkOutAt)
    if (!checkIn || !checkOut) return null

    const sameDay = checkIn.toDateString() === checkOut.toDateString()
    const endText = sameDay
      ? checkOut.toLocaleTimeString(isChinese ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      : formatDateTime(checkOut)
    return `${formatDateTime(checkIn)} - ${endText}`
  }

  const getPointsRecordDescription = (record: PointsRecord, session?: VisitSession): string => {
    if (!isVisitDurationRecord(record)) return formatPointsRecordDescription(record, t)
    if (session?.durationMinutes != null || session?.durationHours != null) {
      const naturalDescription = t('profile.visitDurationFeeWithDuration', {
        duration: formatHoursMinutes(session.durationHours, session.durationMinutes),
        defaultValue: 'Visit duration fee ({{duration}})'
      })
      return isHistoricalPointsRecord(record) ? `${naturalDescription} (H)` : naturalDescription
    }
    const naturalDescription = t('profile.visitDurationFee')
    return isHistoricalPointsRecord(record) ? `${naturalDescription} (H)` : naturalDescription
  }

  const getOrderStatusConfig = (orderStatus: Order['status']) => {
    const statusConfig: Record<string, { bg: string; border: string; color: string; label: string }> = {
      completed: { bg: 'rgba(82,196,26,0.12)', border: 'rgba(82,196,26,0.45)', color: '#52c41a', label: t('ordersAdmin.status.completed') },
      confirmed: { bg: 'rgba(82,196,26,0.12)', border: 'rgba(82,196,26,0.45)', color: '#52c41a', label: t('ordersAdmin.status.confirmed') || 'Confirmed' },
      pending: { bg: 'rgba(244,175,37,0.12)', border: 'rgba(244,175,37,0.45)', color: '#F4AF25', label: t('ordersAdmin.status.pending') },
      cancelled: { bg: 'rgba(255,77,79,0.12)', border: 'rgba(255,77,79,0.4)', color: '#ff4d4f', label: t('ordersAdmin.status.cancelled') },
    }
    return statusConfig[orderStatus] ?? {
      bg: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.15)',
      color: 'rgba(255,255,255,0.6)',
      label: orderStatus
    }
  }

  const openPointsRecordDetails = async (record: PointsRecord) => {
    setSelectedPointsRecord(record)
    setSelectedVisitSession(null)
    setPointsRecordDrawerOpen(true)

    if (record.source !== 'visit' || !record.relatedId) return

    setLoadingPointsRecordDetails(true)
    try {
      const sessionData = await getDocument('visitSessions', record.relatedId) as any
      if (sessionData) {
        setSelectedVisitSession({
          id: record.relatedId,
          ...sessionData,
          checkInAt: toDateValue(sessionData.checkInAt) || new Date(),
          checkOutAt: toDateValue(sessionData.checkOutAt) || undefined,
          createdAt: toDateValue(sessionData.createdAt) || new Date(),
          updatedAt: toDateValue(sessionData.updatedAt) || new Date()
        } as VisitSession)
      }
    } catch (error) {
      console.error('[ProfileView] Failed to load visit session details:', error)
    } finally {
      setLoadingPointsRecordDetails(false)
    }
  }

  const useCompactProfileHeader = isMobile && Boolean(onLogout) && !showMemberCard
  const selectedVisitRedemptions = summarizeVisitRedemptions(selectedVisitSession)
  const detailDrawerRootStyle: React.CSSProperties = detailDrawerWidth && !isMobile
    ? {
      left: `max(var(--app-content-offset, 0px), calc((100% - ${detailDrawerWidth}px) / 2))`,
      right: `max(0px, calc((100% - ${detailDrawerWidth}px) / 2))`,
    }
    : { left: 'var(--app-content-offset, 0px)' }

  const profileActions = showEditButton && onEdit ? (
    <div style={{
      width: '100%',
      maxWidth: '640px',
      margin: useCompactProfileHeader ? '14px 0 0' : '16px auto 0',
      display: 'flex',
      gap: useCompactProfileHeader ? 8 : 2,
    }}>
      <Button
        type="primary"
        onClick={() => onEdit(user)}
        style={{
          flex: 1,
          minWidth: 0,
          height: useCompactProfileHeader ? '42px' : '48px',
          fontSize: useCompactProfileHeader ? '14px' : '16px',
          fontWeight: 'bold',
          background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
          border: 'none',
          borderRadius: '8px',
          color: '#111',
        }}
      >
        {t('profile.editProfile')}
      </Button>
      {onLogout && (
        <Button
          onClick={onLogout}
          style={{
            width: useCompactProfileHeader ? 42 : 48,
            height: useCompactProfileHeader ? 42 : 48,
            flexShrink: 0,
            background: 'transparent',
            border: '1px solid rgba(255,80,80,0.45)',
            borderRadius: '8px',
            color: '#ff6b6b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            padding: 0,
          }}
          icon={<span role="img" aria-label="logout" className="anticon anticon-logout"><svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor"><path d="M868 732h-70.3c-4.8 0-9.3 2.1-12.3 5.8-7 8.5-14.5 16.7-22.4 24.5a353.84 353.84 0 01-112.7 75.9A352.8 352.8 0 01512.4 866c-47.9 0-94.3-9.4-137.9-27.8a353.84 353.84 0 01-112.7-75.9 353.28 353.28 0 01-76-112.5C167.3 606.2 158 559.9 158 512s9.4-94.2 27.8-137.8c17.8-42.1 43.4-80 76-112.5s70.5-58.1 112.7-75.9c43.6-18.4 90-27.8 137.9-27.8 47.9 0 94.3 9.3 137.9 27.8 42.2 17.8 80.1 43.4 112.7 75.9 7.9 7.9 15.3 16.1 22.4 24.5 3 3.7 7.6 5.8 12.3 5.8H868c6.3 0 10.2-7 6.7-12.3C798 160.5 663.8 81.6 511.3 82 271.7 82.6 79.6 277.1 82 516.4 84.4 751.9 276.2 942 512.4 942c152.1 0 285.7-78.8 362.3-197.7 3.4-5.3-.4-12.3-6.7-12.3zm88.9-226.3L815 393.7c-5.3-4.2-13-.4-13 6.3v76H488c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h314v76c0 6.7 7.8 10.5 13 6.3l141.9-112a8 8 0 000-12.6z"/></svg></span>}
        />
      )}
    </div>
  ) : null

  return (
    <div style={{ color: '#FFFFFF' }}>
      <CigarRedemptionDrawer
        open={active && !closing && Boolean(selectedCigarGroup)}
        afterOpenChange={(open) => onDrawerOpenChange('group', open)}
        group={active ? selectedCigarGroup : null}
        onClose={() => setSelectedCigarGroup(null)}
        rootStyle={detailDrawerRootStyle}
        isMobile={isMobile}
        formatDateTime={formatDateTime}
        formatVisitPeriod={formatVisitPeriod}
      />
      <Drawer
        title={t('profile.cigarRecordDetails')}
        placement="bottom"
        rootStyle={detailDrawerRootStyle}
        zIndex={2100}
        open={active && !closing && cigarRecordDrawerOpen}
        afterOpenChange={(open) => onDrawerOpenChange('cigar', open)}
        onClose={() => setCigarRecordDrawerOpen(false)}
        height={isMobile ? '56vh' : 420}
        styles={{
          content: { background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)' },
          header: { borderBottom: '1px solid rgba(244,175,37,0.25)' },
          body: { padding: isMobile ? 16 : 24 }
        }}
      >
        {selectedOrder && (() => {
          const status = getOrderStatusConfig(selectedOrder.status)
          const orderNumber = selectedOrder.orderNo || selectedOrder.id
          const totalQuantity = selectedOrder.items.reduce((sum, item) => sum + item.quantity, 0)
          return (
            <div style={{ maxWidth: 640, margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#f4cf72', fontSize: 15, fontWeight: 800, overflowWrap: 'anywhere' }}>
                    # {orderNumber.toUpperCase()}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4 }}>
                    {formatDateTime(selectedOrder.createdAt)}
                  </div>
                </div>
                <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: status.bg, border: `1px solid ${status.border}`, color: status.color, whiteSpace: 'nowrap' }}>
                  {status.label}
                </span>
              </div>

              <div style={{ display: 'grid', gap: 1, overflow: 'hidden', border: '1px solid rgba(244,175,37,0.18)', borderRadius: 8, background: 'rgba(244,175,37,0.12)' }}>
                {selectedOrder.items.map((item, index) => (
                  <div key={`${item.cigarId}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#1d1a14' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: 650, overflowWrap: 'anywhere' }}>
                        {item.name || item.cigarId}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}>
                        RM {Number(item.price || 0).toFixed(2)} × {item.quantity}
                      </div>
                    </div>
                    <div style={{ color: '#f4cf72', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      RM {(Number(item.price || 0) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(244,175,37,0.18)' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                  {totalQuantity} {t('ordersAdmin.totalQuantity')}
                </span>
                <span style={{ color: '#f4cf72', fontSize: 20, fontWeight: 800 }}>
                  RM {Number(selectedOrder.total || 0).toFixed(2)}
                </span>
              </div>
            </div>
          )
        })()}
      </Drawer>

      <Drawer
        title={t('profile.pointsRecords')}
        placement="bottom"
        rootStyle={detailDrawerRootStyle}
        zIndex={2100}
        open={active && !closing && pointsRecordDrawerOpen}
        afterOpenChange={(open) => onDrawerOpenChange('points', open)}
        onClose={() => setPointsRecordDrawerOpen(false)}
        height="auto"
        styles={{
          wrapper: { maxHeight: 'calc(100dvh - 24px)' },
          content: {
            background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
            maxHeight: 'calc(100dvh - 24px)'
          },
          header: { borderBottom: '1px solid rgba(244,175,37,0.25)', flexShrink: 0 },
          body: { padding: isMobile ? 16 : 24, minHeight: 0, overflowY: 'auto' }
        }}
      >
        {selectedPointsRecord && (
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>
                  {getPointsRecordDescription(selectedPointsRecord, pointsVisitSessions[selectedPointsRecord.relatedId || ''])}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 5 }}>
                  {formatDateTime(selectedPointsRecord.createdAt)}
                </div>
              </div>
              <div style={{ color: selectedPointsRecord.type === 'earn' ? '#52c41a' : '#ff4d4f', fontSize: 24, fontWeight: 800, whiteSpace: 'nowrap' }}>
                {selectedPointsRecord.type === 'earn' ? '+' : '-'}{selectedPointsRecord.amount}
                <span style={{ fontSize: 11, marginLeft: 4, fontWeight: 500 }}>pts</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 1, overflow: 'hidden', border: '1px solid rgba(244,175,37,0.18)', borderRadius: 8, background: 'rgba(244,175,37,0.12)' }}>
              {[
                [t('pointsConfig.records.source'), t(`pointsConfig.records.sources.${selectedPointsRecord.source}`) || selectedPointsRecord.source],
                [t('pointsConfig.records.balance'), selectedPointsRecord.balance ?? '-'],
                [
                  t(selectedPointsRecord.source === 'reload' ? 'profile.approvedBy' : 'profile.processedBy'),
                  pointsRecordReviewer.id === 'system'
                    ? t('profile.systemOperator')
                    : pointsRecordReviewer.name || pointsRecordReviewer.id || '-'
                ]
              ].map(([label, value]) => (
                <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 12px', background: '#1d1a14' }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{label}</span>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>

            {loadingPointsRecordDetails ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : selectedVisitSession && (
              <div style={{ marginTop: 14 }}>
                <div style={{ color: '#f4cf72', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  {t('navigation.visitSessions')}
                </div>
                <div style={{ display: 'grid', gap: 1, overflow: 'hidden', border: '1px solid rgba(244,175,37,0.18)', borderRadius: 8, background: 'rgba(244,175,37,0.12)' }}>
                  {[
                    [t('visitSessions.checkIn'), formatDateTime(selectedVisitSession.checkInAt)],
                    [t('visitSessions.checkOut'), formatDateTime(selectedVisitSession.checkOutAt)],
                    [
                      t('visitSessions.duration'),
                      selectedVisitSession.durationHours != null || selectedVisitSession.durationMinutes != null
                        ? formatHoursMinutes(selectedVisitSession.durationHours, selectedVisitSession.durationMinutes)
                        : '-'
                    ],
                    [t('visitSessions.status'), t(`visitSessions.status${selectedVisitSession.status.charAt(0).toUpperCase()}${selectedVisitSession.status.slice(1)}`)]
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 12px', background: '#1d1a14' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{label}</span>
                      <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>
                {selectedVisitRedemptions.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ color: '#f4cf72', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      {t('profile.cigarRecords')}
                    </div>
                    <div style={{ display: 'grid', gap: 1, overflow: 'hidden', border: '1px solid rgba(244,175,37,0.18)', borderRadius: 8, background: 'rgba(244,175,37,0.12)' }}>
                      {selectedVisitRedemptions.map(redemption => (
                        <div key={redemption.cigarId || redemption.cigarName} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 12px', background: '#1d1a14' }}>
                          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {redemption.cigarName || t('profile.unknownCigar')}
                          </span>
                          <span style={{ color: '#FDE08D', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            x{redemption.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* User Profile Section */}
      <div style={{
        maxWidth: '640px',
        margin: '0 auto 10px',
        textAlign: 'center',
      }}>
        <div style={useCompactProfileHeader ? {
          display: 'grid',
          gridTemplateColumns: '136px minmax(0, 1fr)',
          alignItems: 'center',
          columnGap: '18px',
          padding: '12px 4px 8px',
        } : undefined}>
          {/* Avatar/Member Card */}
          <div style={useCompactProfileHeader ? {
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minWidth: 0,
          } : undefined}>
            <MemberProfileCard
              user={user}
              showMemberCard={showMemberCard}
              onToggleMemberCard={setShowMemberCard}
              getMembershipText={getMembershipText}
              enableQrModal={true}
              style={useCompactProfileHeader ? { marginBottom: '30px' } : undefined}
            />
          </div>

          {/* User Info */}
          {!(onLogout && showMemberCard) && (
            <div style={{
              minWidth: 0,
              marginTop: useCompactProfileHeader ? 0 : '16px',
              textAlign: useCompactProfileHeader ? 'left' : 'center',
            }}>
              <h2 style={{
                fontSize: useCompactProfileHeader ? '18px' : '16px',
                fontWeight: 'bold',
                color: '#FFFFFF',
                margin: '0 0 8px 0'
              }}>
                {user.displayName || t('profile.noNameSet')}
              </h2>
              <div style={{
                fontSize: useCompactProfileHeader ? '12px' : '14px',
                lineHeight: 1.45,
                color: 'rgba(255, 255, 255, 0.6)',
              }}>
                <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{t('auth.email')}: {user.email || '-'}</p>
                <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{t('auth.phone')}: {(user as any)?.profile?.phone || '-'}</p>
                {canViewDiscount && (user.discount?.rate !== undefined || user.discount?.note) && (
                  <p style={{ margin: '4px 0', color: '#FDE08D' }}>
                    {t('profile.discount')}: {user.discount?.rate !== undefined ? `${user.discount?.rate}%` : '—'}
                    {user.discount?.note ? ` (${user.discount.note})` : ''}
                  </p>
                )}
              </div>
              {useCompactProfileHeader && profileActions}
            </div>
          )}
        </div>

        {!useCompactProfileHeader && profileActions}
      </div>

      {/* Stats Section - Unified Card */}
      <div style={{
        marginBottom: '10px',
        maxWidth: '640px',
        margin: '0 auto 12px auto',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        border: '1px solid rgba(244, 175, 37, 0.6)',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))'
      }}>
        {userStats.map((stat, index) => {
          const titleLines = getStatTitleLines(stat.title)
          return (
            <div key={stat.title} style={{
              minWidth: 0,
              padding: isMobile ? '14px 4px' : '16px 8px',
              textAlign: 'center',
              borderRight: index < userStats.length - 1 ? '1px solid rgba(244, 175, 37, 0.25)' : 'none',
            }}>
              <div style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: 'bold', color: '#FFFFFF', marginBottom: '4px' }}>
                {stat.value}
              </div>
              <div style={{ minHeight: isMobile ? 30 : 'auto', fontSize: isMobile ? '10px' : '11px', lineHeight: 1.35, color: 'rgba(255, 255, 255, 0.6)', overflowWrap: 'anywhere' }}>
                {titleLines.map((line, lineIndex) => (
                  <React.Fragment key={`${stat.title}-${lineIndex}`}>
                    {lineIndex > 0 && <br />}
                    {line}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* AI Recognition History Entry */}
      {user?.id === authUser?.id && aiCigarHistoryVisible && (
        <div style={{
          maxWidth: '640px',
          margin: '0 auto 24px auto'
        }}>
          <Button
            type="default"
            onClick={() => navigate('/ai-cigar-history')}
            style={{
              width: '100%',
              height: '48px',
              fontSize: '16px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '8px',
              color: '#ffd700',
              fontWeight: 500
            }}
          >
            <span style={{
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontWeight: 'bold'
            }}>
              {t('profile.viewAiHistory')}
            </span>
          </Button>
        </div>
      )}

      {/* Tabs Section */}
      <div>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(244,175,37,0.2)',
          marginBottom: '24px'
        }}>
          {(['cigar', 'points', 'activity', 'referral'] as const)
            .filter((tabKey) => {
              // Hide activity tab if feature hidden
              if (tabKey === 'activity' && !eventsFeatureVisible) {
                return false
              }
              return true
            })
            .map((tabKey) => {
              const isActive = activeTab === tabKey
              const baseStyle: React.CSSProperties = {
                flex: 1,
                padding: '10px 0',
                fontWeight: 800,
                fontSize: 12,
                lineHeight: 1.35,
                minHeight: 52,
                whiteSpace: 'normal',
                borderBottom: isActive ? '2px solid transparent' : '2px solid transparent',
                cursor: 'pointer',
                border: 'none',
                backgroundColor: 'transparent',
                position: 'relative' as const,
              }
              const activeStyle: React.CSSProperties = {
                color: 'transparent',
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                backgroundColor: 'transparent',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }
              const inactiveStyle: React.CSSProperties = {
                color: '#A0A0A0'
              }

              const getTabLabel = (key: string) => {
                switch (key) {
                  case 'cigar': return t('profile.cigarRecords')
                  case 'points': return t('profile.pointsRecords')
                  case 'activity': return t('profile.activityRecords')
                  case 'referral': return t('profile.referralRecords')
                  default: return ''
                }
              }

              const label = getTabLabel(tabKey)
              const labelLines = label.endsWith('记录')
                ? [label.slice(0, -2), '记录']
                : (() => {
                    const lastSpace = label.lastIndexOf(' ')
                    return lastSpace > 0
                      ? [label.slice(0, lastSpace), label.slice(lastSpace + 1)]
                      : [label, '\u00A0']
                  })()

              return (
                <button
                  key={tabKey}
                  type="button"
                  className="profile-record-tab"
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    ...baseStyle,
                    ...(isActive ? activeStyle : inactiveStyle),
                  }}
                  onClick={() => setActiveTab(tabKey)}
                >
                  {labelLines[0]}
                  <br />
                  {labelLines[1]}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '2px',
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    }} />
                  )}
                </button>
              )
            })}
        </div>

        {/* Records List */}
        <div style={{ paddingBottom: '24px' }}>
          {activeTab === 'cigar' && (
            loadingOrders || loadingRedemptions ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                  fontSize: '36px',
                  background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  marginBottom: 12
                }}>
                  <ShoppingOutlined spin />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {t('common.loading')}
                </Text>
              </div>
            ) : userRedemptions.length === 0 && purchaseOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                  fontSize: '48px',
                  marginBottom: 16,
                  opacity: 0.25,
                  color: '#F4AF25'
                }}>
                  <ShoppingOutlined />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, display: 'block' }}>
                  {t('profile.noCigarRecords')}
                </Text>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: isMobile ? 12 : 16
              }}>
                {cigarGroups.map((group) => {
                  const isCompleted = group.pendingQuantity === 0

                  return (
                    <button
                      type="button"
                      key={group.key}
                      aria-label={`${t('profile.cigarRecordDetails')}: ${group.cigarName || t('profile.unknownCigar')}`}
                      onClick={() => setSelectedCigarGroup(group)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        font: 'inherit',
                        color: 'inherit',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: 8,
                        border: '1px solid rgba(244,175,37,0.18)',
                        borderLeft: `3px solid ${isCompleted ? '#52c41a' : '#F4AF25'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: isMobile ? '11px 12px' : '12px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>
                            {group.cigarName || t('profile.unknownCigar')}
                          </div>
                          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4 }}>
                            {formatDateTime(group.records[0].redeemedAt)}
                          </div>
                        </div>
                        <Tag color={isCompleted ? 'green' : 'gold'} style={{ margin: 0, flexShrink: 0 }}>
                          {isCompleted
                            ? t('profile.redeemed', { defaultValue: 'Redeemed' })
                            : t('profile.pendingRedemption', { defaultValue: 'Pending' })}
                        </Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
                        <span>
                          {t('profile.redeemed')}
                        </span>
                        <span style={{ color: '#FDE08D', fontWeight: 700 }}>x{group.completedQuantity}</span>
                      </div>
                      {group.pendingQuantity > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#F4AF25', fontSize: 12 }}>
                          <span>{t('profile.pendingRedemption')}</span>
                          <span>x{group.pendingQuantity}</span>
                        </div>
                      )}
                    </button>
                  )
                })}
                {purchaseOrders.map((order) => {
                  const orderDate = order.createdAt instanceof Date
                    ? order.createdAt
                    : (order.createdAt as any)?.toDate
                      ? (order.createdAt as any).toDate()
                      : new Date(order.createdAt)

                  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0)
                  const displayOrderNumber = order.orderNo || order.id

                  const status = getOrderStatusConfig(order.status)

                  return (
                    <div
                      key={order.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t('profile.cigarRecordDetails')}: ${displayOrderNumber}`}
                      onClick={() => {
                        setSelectedOrder(order)
                        setCigarRecordDrawerOpen(true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedOrder(order)
                          setCigarRecordDrawerOpen(true)
                        }
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: 12,
                        border: '1px solid rgba(244,175,37,0.18)',
                        borderLeft: '3px solid #C48D3A',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: isMobile ? '9px 12px' : '10px 14px',
                        cursor: 'pointer'
                      }}
                    >
                      {/* Card header */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10
                      }}>
                        <div style={{
                          minWidth: 0,
                          fontSize: isMobile ? 12 : 13,
                          lineHeight: 1.3,
                          fontWeight: 700,
                          background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text',
                          overflowWrap: 'anywhere'
                        }}>
                          # {displayOrderNumber.toUpperCase()}
                        </div>
                        <div style={{
                          padding: '2px 9px',
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 600,
                          background: status.bg,
                          border: `1px solid ${status.border}`,
                          color: status.color,
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          marginLeft: 8
                        }}>
                          {status.label}
                        </div>
                      </div>

                      {/* Items list */}
                      <div style={{ flex: 1 }}>
                        {order.items.map((item, index) => {
                          const displayName = item.cigarId.startsWith('FEE:')
                            ? t('eventsAdmin.eventFee')
                            : (item.name || item.cigarId)

                          return (
                            <div key={index} style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '3px 0',
                              borderBottom: index < order.items.length - 1
                                ? '1px solid rgba(255,255,255,0.05)'
                                : 'none',
                              gap: 8
                            }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                minWidth: 0,
                                flex: 1
                              }}>
                                <div style={{
                                  width: 4,
                                  height: 4,
                                  borderRadius: '50%',
                                  background: 'rgba(244,175,37,0.5)',
                                  flexShrink: 0
                                }} />
                                <span style={{
                                  color: 'rgba(255,255,255,0.82)',
                                  fontSize: isMobile ? 12 : 13,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {displayName}
                                </span>
                              </div>
                              <span style={{
                                color: 'rgba(255,255,255,0.4)',
                                fontSize: 12,
                                flexShrink: 0,
                                background: 'rgba(255,255,255,0.06)',
                                padding: '1px 7px',
                                borderRadius: 10
                              }}>
                                ×{item.quantity}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Footer */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          color: 'rgba(255,255,255,0.35)',
                          fontSize: 10,
                          minWidth: 0
                        }}>
                          <span style={{ whiteSpace: 'nowrap' }}>{formatDate(orderDate)}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <ShoppingOutlined style={{ fontSize: 10 }} />
                            {totalQuantity} {t('ordersAdmin.totalQuantity') || 'items'}
                          </span>
                        </div>
                        <div style={{
                          fontSize: isMobile ? 14 : 15,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text'
                        }}>
                          RM {order.total.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {activeTab === 'points' && (
            loadingPointsRecords ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36, color: '#F4AF25', marginBottom: 12 }}>
                  <TrophyOutlined spin />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {t('common.loading')}
                </Text>
              </div>
            ) : pointsRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.25, color: '#F4AF25' }}>
                  <TrophyOutlined />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, display: 'block' }}>
                  {t('profile.noPointsRecords')}
                </Text>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pointsRecords.map((record) => {
                  const isEarn = record.type === 'earn'
                  const accentColor = isEarn ? '#52c41a' : '#ff4d4f'
                  const accentBg = isEarn ? 'rgba(82,196,26,0.06)' : 'rgba(255,77,79,0.06)'
                  const visitSession = record.relatedId ? pointsVisitSessions[record.relatedId] : undefined
                  const recordDescription = getPointsRecordDescription(record, visitSession)
                  const visitPeriod = formatVisitPeriod(visitSession)

                  return (
                    <button
                      type="button"
                      key={record.id}
                      aria-label={`${t('profile.pointsRecords')}: ${recordDescription}`}
                      onClick={() => openPointsRecordDetails(record)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: isMobile ? 12 : 16,
                        padding: isMobile ? '12px 14px' : '13px 16px',
                        borderRadius: 10,
                        background: accentBg,
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderLeft: `3px solid ${accentColor}`,
                        color: 'inherit',
                        font: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: isMobile ? 36 : 40,
                        height: isMobile ? 36 : 40,
                        borderRadius: '50%',
                        background: isEarn ? 'rgba(82,196,26,0.12)' : 'rgba(255,77,79,0.12)',
                        border: `1px solid ${isEarn ? 'rgba(82,196,26,0.3)' : 'rgba(255,77,79,0.3)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: 16,
                        color: accentColor
                      }}>
                        {isEarn ? <TrophyOutlined /> : <ShoppingOutlined />}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: isMobile ? 13 : 14,
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.88)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginBottom: 3
                        }}>
                          {recordDescription}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.35)',
                          }}>
                            {visitPeriod || formatDateTime(record.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Amount */}
                      <div style={{
                        flexShrink: 0,
                        textAlign: 'right'
                      }}>
                        <div style={{
                          fontSize: isMobile ? 18 : 20,
                          fontWeight: 800,
                          color: accentColor,
                          lineHeight: 1,
                          letterSpacing: '-0.5px'
                        }}>
                          {isEarn ? '+' : '-'}{record.amount}
                        </div>
                        <div style={{
                          fontSize: 10,
                          color: 'rgba(255,255,255,0.3)',
                          marginTop: 3,
                          textAlign: 'right'
                        }}>
                          pts
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {activeTab === 'activity' && (
            (loadingEvents || loadingVisitSessions) ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36, color: '#F4AF25', marginBottom: 12 }}>
                  <CalendarOutlined spin />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {t('common.loading')}
                </Text>
              </div>
            ) : userEvents.length === 0 && userVisitSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.25, color: '#F4AF25' }}>
                  <CalendarOutlined />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, display: 'block' }}>
                  {t('profile.noActivityRecords')}
                </Text>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: isMobile ? 12 : 16
              }}>
                {userVisitSessions.map((session) => {
                  const statusKey = `visitSessions.status${session.status.charAt(0).toUpperCase()}${session.status.slice(1)}`
                  const statusColor = session.status === 'completed'
                    ? '#52c41a'
                    : session.status === 'pending' ? '#F4AF25' : '#ff7875'
                  const period = formatVisitPeriod(session)
                  const visitTypeLabel = session.checkInType === 'daypass'
                    ? t('profile.dayPass')
                    : t('profile.annualPass')
                  return (
                    <div
                      key={`visit-${session.id}`}
                      style={{
                        borderRadius: 12,
                        border: '1px solid rgba(244,175,37,0.2)',
                        background: 'rgba(255,255,255,0.04)',
                        padding: isMobile ? '12px 14px' : '14px 16px',
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {session.storeName || t('navigation.visitSessions')}
                          </div>
                          <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, marginTop: 4 }}>
                            {period || formatDateTime(session.checkInAt)}
                          </div>
                        </div>
                        <span style={{ color: statusColor, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {t(statusKey)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, color: '#FDE08D', fontSize: 12, fontWeight: 700 }}>
                        <span>{visitTypeLabel}</span>
                        <span style={{ color: 'rgba(255,255,255,0.3)' }}>&middot;</span>
                        <ClockCircleOutlined />
                        <span>{formatHoursMinutes(session.durationHours, session.durationMinutes)}</span>
                      </div>
                    </div>
                  )
                })}
                {userEvents.map((event) => {
                  const startDate = event.schedule.startDate instanceof Date
                    ? event.schedule.startDate
                    : (event.schedule.startDate as any)?.toDate
                      ? (event.schedule.startDate as any).toDate()
                      : new Date(event.schedule.startDate)

                  const isRegistered = event.participants?.registered?.includes(user?.id || '')
                  const isCheckedIn = event.participants?.checkedIn?.includes(user?.id || '')

                  const eventStatusConfig: Record<string, { bg: string; border: string; color: string; label: string }> = {
                    upcoming: { bg: 'rgba(64,169,255,0.12)', border: 'rgba(64,169,255,0.4)', color: '#40a9ff', label: t('profile.eventStatus.upcoming') },
                    ongoing:  { bg: 'rgba(82,196,26,0.12)',  border: 'rgba(82,196,26,0.4)',  color: '#52c41a', label: t('profile.eventStatus.ongoing') },
                    completed:{ bg: 'rgba(255,255,255,0.06)',border: 'rgba(255,255,255,0.15)',color: 'rgba(255,255,255,0.5)', label: t('profile.eventStatus.completed') },
                    cancelled:{ bg: 'rgba(255,77,79,0.12)',  border: 'rgba(255,77,79,0.4)',  color: '#ff4d4f', label: t('profile.eventStatus.cancelled') },
                  }
                  const evStatus = eventStatusConfig[event.status] ?? eventStatusConfig.completed

                  return (
                    <div
                      key={event.id}
                      style={{
                        borderRadius: 12,
                        border: '1px solid rgba(244,175,37,0.15)',
                        overflow: 'hidden',
                        background: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      {/* Cover image */}
                      <div style={{
                        width: '100%',
                        height: isMobile ? 100 : 120,
                        position: 'relative',
                        overflow: 'hidden',
                        background: 'rgba(255,255,255,0.06)',
                        flexShrink: 0
                      }}>
                        {event.coverImage ? (
                          <img
                            src={event.coverImage}
                            alt={event.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <div style={{
                            width: '100%', height: '100%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'rgba(255,255,255,0.15)', fontSize: 36
                          }}>
                            <CalendarOutlined />
                          </div>
                        )}
                        {/* Participation overlay badge */}
                        {(isCheckedIn || isRegistered) && (
                          <div style={{
                            position: 'absolute', top: 8, right: 8,
                            padding: '3px 9px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            backdropFilter: 'blur(8px)',
                            ...(isCheckedIn
                              ? { background: 'rgba(82,196,26,0.85)', color: '#fff' }
                              : { background: 'linear-gradient(to right, #FDE08D, #C48D3A)', color: '#111' })
                          }}>
                            {isCheckedIn
                              ? `✓ ${t('profile.participationStatus.checkedIn')}`
                              : t('profile.participationStatus.registered')}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: isMobile ? '12px 14px' : '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{
                          fontSize: isMobile ? 14 : 15,
                          fontWeight: 700,
                          color: '#fff',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {event.title}
                        </div>

                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8
                        }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            color: 'rgba(255,255,255,0.4)', fontSize: 12
                          }}>
                            <CalendarOutlined style={{ fontSize: 11 }} />
                            <span>{formatDate(startDate)}</span>
                          </div>
                          <div style={{
                            padding: '2px 9px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 600,
                            background: evStatus.bg,
                            border: `1px solid ${evStatus.border}`,
                            color: evStatus.color,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}>
                            {evStatus.label}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {activeTab === 'referral' && (
            <>
              {/* Stats bar */}
              <div style={{
                display: 'flex',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid rgba(244,175,37,0.2)',
                marginBottom: 16,
                background: 'rgba(255,255,255,0.03)'
              }}>
                {[
                  { icon: <TeamOutlined />, value: referredUsers.length, label: t('profile.totalReferred') },
                  { icon: <TrophyOutlined />, value: user?.membership?.referralPoints || 0, label: t('profile.referralPoints') }
                ].map((stat, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <div style={{ width: 1, background: 'rgba(244,175,37,0.15)', flexShrink: 0 }} />}
                    <div style={{
                      flex: 1,
                      minWidth: 0,
                      padding: isMobile ? '12px 14px' : '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10
                    }}>
                      <div style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.45)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        minWidth: 0,
                        maxWidth: isMobile ? 76 : 110,
                        lineHeight: 1.25,
                        textAlign: 'left'
                      }}>
                        <span style={{
                          width: 28,
                          height: 28,
                          fontSize: 28,
                          lineHeight: 1,
                          color: 'rgba(244,175,37,0.6)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {stat.icon}
                        </span>
                        <span>{stat.label}</span>
                      </div>
                      <div style={{
                        fontSize: isMobile ? 22 : 26,
                        fontWeight: 800,
                        background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        lineHeight: 1,
                        flexShrink: 0,
                        textAlign: 'right'
                      }}>
                        {stat.value}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Referral List */}
              {loadingReferrals ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 36, color: '#F4AF25', marginBottom: 12 }}>
                    <TeamOutlined spin />
                  </div>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    {t('common.loading')}
                  </Text>
                </div>
              ) : referredUsers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.25, color: '#F4AF25' }}>
                    <TeamOutlined />
                  </div>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, display: 'block' }}>
                    {t('profile.noReferralRecords')}
                  </Text>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: isMobile ? 10 : 14
                }}>
                  {referredUsers.map((referred) => {
                    const joinDate = referred.createdAt instanceof Date
                      ? referred.createdAt
                      : (referred.createdAt as any)?.toDate
                        ? (referred.createdAt as any).toDate()
                        : new Date(referred.createdAt)

                    const activatedAt = referralActivationMap[referred.id]
                    const isMembershipActivated = Boolean(activatedAt || referred.status === 'active')
                    const initial = (referred.displayName?.charAt(0) || '?').toUpperCase()

                    return (
                      <div key={referred.id} style={{
                        borderRadius: 12,
                        border: '1px solid rgba(244,175,37,0.15)',
                        background: 'rgba(255,255,255,0.04)',
                        padding: isMobile ? '11px 12px' : '13px 14px',
                        display: 'grid',
                        gridTemplateColumns: `${isMobile ? 44 : 48}px minmax(0, 1fr) auto`,
                        alignItems: 'center',
                        gap: isMobile ? 10 : 12,
                        overflow: 'hidden'
                        }}>
                        {/* Avatar */}
                        <div style={{
                          width: isMobile ? 44 : 48,
                          height: isMobile ? 44 : 48,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, rgba(253,224,141,0.15), rgba(196,141,58,0.08))',
                          border: '2px solid rgba(244,175,37,0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <span style={{
                            background: 'linear-gradient(135deg, #FDE08D, #C48D3A)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            fontWeight: 800,
                            fontSize: isMobile ? 18 : 20,
                            lineHeight: 1
                          }}>
                            {initial}
                          </span>
                        </div>

                        {/* Name + member number */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: isMobile ? 14 : 15,
                            fontWeight: 700,
                            color: '#fff',
                            textTransform: 'uppercase',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.3px'
                          }}>
                            {referred.displayName || t('profile.unknownUser')}
                          </div>
                          {referred.memberId && (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2
                            }}>
                              <NumberOutlined style={{ fontSize: 10 }} />
                              <span>{referred.memberId}</span>
                            </div>
                          )}
                        </div>

                        {/* Dates and membership */}
                        <div style={{ minWidth: isMobile ? 148 : 164, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                              <CalendarOutlined style={{ fontSize: 10, color: 'rgba(244,175,37,0.5)' }} />
                              {t('profile.joinDate')}
                            </span>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
                              {formatDate(joinDate)}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                            {isMembershipActivated
                                ? <CheckCircleOutlined style={{ fontSize: 10, color: '#52c41a' }} />
                                : <ClockCircleOutlined style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }} />
                            }
                              {t('profile.membership')}
                            </span>
                            {isMembershipActivated ? (
                              <span style={{
                                fontSize: 10,
                                padding: '1px 6px', borderRadius: 8,
                                background: 'rgba(82,196,26,0.12)',
                                border: '1px solid rgba(82,196,26,0.3)',
                                color: '#52c41a',
                                whiteSpace: 'nowrap'
                              }}>
                                {activatedAt ? formatDate(activatedAt) : t('profile.activatedMembership')}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 10,
                                padding: '1px 6px', borderRadius: 8,
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.3)',
                                whiteSpace: 'nowrap'
                              }}>
                                {t('profile.notActivated')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
