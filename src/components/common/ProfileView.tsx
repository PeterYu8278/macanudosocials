// Common User Profile View Component
import React, { useMemo, useState, useEffect } from 'react'
import { Row, Col, Card, Typography, Tag, Button, Space, Spin, App } from 'antd'
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
import type { User, Event, Order, Cigar, PointsRecord } from '../../types'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MemberProfileCard } from './MemberProfileCard'
import { isFeatureVisible } from '../../services/firebase/featureVisibility'
import { useAuthStore } from '../../store/modules/auth'
import { textTransform } from 'html2canvas/dist/types/css/property-descriptors/text-transform'

interface ProfileViewProps {
  user?: User | null          // Direct user object
  userId?: string              // Or User ID (loaded internally)
  readOnly?: boolean           // Read-only mode
  showEditButton?: boolean     // Show edit button
  onEdit?: (user: User) => void // Edit callback
  onLogout?: () => void        // Logout callback
}

export const ProfileView: React.FC<ProfileViewProps> = ({
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
  const [userOrders, setUserOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [referredUsers, setReferredUsers] = useState<User[]>([])
  const [loadingReferrals, setLoadingReferrals] = useState(false)
  const [pointsRecords, setPointsRecords] = useState<PointsRecord[]>([])
  const canViewDiscount = authUser?.role === 'developer' || authUser?.role === 'superAdmin'
  const [loadingPointsRecords, setLoadingPointsRecords] = useState(false)
  const [referralActivationMap, setReferralActivationMap] = useState<Record<string, Date | null>>({})
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  )
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
  }, [user?.id])

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
      } catch (error) {
        console.error('[ProfileView] Failed to load points records:', error)
        message.error(t('pointsConfig.loadRecordsFailed'))
        setPointsRecords([])
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

  // Total cigars purchased calculation
  const totalCigarsPurchased = useMemo(() => {
    return userOrders.reduce((total, order) => {
      const orderTotal = order.items.reduce((sum, item) => sum + item.quantity, 0)
      return total + orderTotal
    }, 0)
  }, [userOrders])

  // User stats data
  const userStats = [
    { title: t('profile.eventsJoined'), value: userEvents.length, icon: <CalendarOutlined /> },
    { title: t('profile.cigarsPurchased'), value: totalCigarsPurchased, icon: <ShoppingOutlined /> },
    { title: t('profile.communityPoints'), value: (user?.membership as any)?.points || 0, icon: <TrophyOutlined /> },
  ]

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

  return (
    <div style={{ color: '#FFFFFF' }}>
      {/* User Profile Section */}
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        {/* Avatar/Member Card */}
        <MemberProfileCard
          user={user}
          showMemberCard={showMemberCard}
          onToggleMemberCard={setShowMemberCard}
          getMembershipText={getMembershipText}
          enableQrModal={true}
        />

        {/* User Info */}
        <div style={{ marginTop: '16px' }}>
          <h2 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#FFFFFF',
            margin: '0 0 8px 0'
          }}>
            {user.displayName || t('profile.noNameSet')}
          </h2>
          <div style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.6)' }}>
            <p style={{ margin: '4px 0' }}>{t('auth.email')}: {user.email || '-'}</p>
            <p style={{ margin: '4px 0' }}>{t('auth.phone')}: {(user as any)?.profile?.phone || '-'}</p>
            {canViewDiscount && (user.discount?.rate !== undefined || user.discount?.note) && (
              <p style={{ margin: '4px 0', color: '#FDE08D' }}>
                {t('profile.discount')}: {user.discount?.rate !== undefined ? `${user.discount?.rate}%` : '—'}
                {user.discount?.note ? ` (${user.discount.note})` : ''}
              </p>
            )}
          </div>
        </div>

        {/* Edit + Logout Buttons */}
        {showEditButton && onEdit && (
          <div style={{ width: '100%', maxWidth: '640px', margin: '16px auto 0 auto', display: 'flex', gap: 2 }}>
            <Button
              type="primary"
              onClick={() => onEdit(user)}
              style={{
                flex: 1,
                height: '48px',
                fontSize: '16px',
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
                  width: 48,
                  height: 48,
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
        )}
      </div>

      {/* Stats Section - Unified Card */}
      <div style={{
        marginBottom: '10px',
        maxWidth: '640px',
        margin: '0 auto 12px auto',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        border: '1px solid rgba(244, 175, 37, 0.6)',
        padding: '16px 0',
        display: 'flex',
        alignItems: 'center'
      }}>
        {userStats.map((stat, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <div style={{
                width: '1px',
                height: '36px',
                background: 'rgba(244, 175, 37, 0.25)',
                flexShrink: 0
              }} />
            )}
            <div style={{
              flex: 1,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#FFFFFF', marginBottom: '4px' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
                {stat.title}
              </div>
            </div>
          </React.Fragment>
        ))}
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
                  {getTabLabel(tabKey)}
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
            loadingOrders ? (
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
            ) : userOrders.length === 0 ? (
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
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                gap: isMobile ? 12 : 16
              }}>
                {userOrders.map((order) => {
                  const orderDate = order.createdAt instanceof Date
                    ? order.createdAt
                    : (order.createdAt as any)?.toDate
                      ? (order.createdAt as any).toDate()
                      : new Date(order.createdAt)

                  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0)

                  const statusConfig: Record<string, { bg: string; border: string; color: string; label: string }> = {
                    completed: { bg: 'rgba(82,196,26,0.12)', border: 'rgba(82,196,26,0.45)', color: '#52c41a', label: t('ordersAdmin.status.completed') },
                    confirmed: { bg: 'rgba(82,196,26,0.12)', border: 'rgba(82,196,26,0.45)', color: '#52c41a', label: t('ordersAdmin.status.confirmed') || 'Confirmed' },
                    pending: { bg: 'rgba(244,175,37,0.12)', border: 'rgba(244,175,37,0.45)', color: '#F4AF25', label: t('ordersAdmin.status.pending') },
                    cancelled: { bg: 'rgba(255,77,79,0.12)', border: 'rgba(255,77,79,0.4)', color: '#ff4d4f', label: t('ordersAdmin.status.cancelled') },
                  }
                  const status = statusConfig[order.status] ?? { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', label: order.status }

                  return (
                    <div
                      key={order.id}
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: 12,
                        border: '1px solid rgba(244,175,37,0.18)',
                        borderLeft: '3px solid #C48D3A',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      {/* Card header */}
                      <div style={{
                        padding: isMobile ? '12px 14px 10px' : '14px 16px 10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        borderBottom: '1px solid rgba(255,255,255,0.06)'
                      }}>
                        <div>
                          <div style={{
                            fontSize: isMobile ? 13 : 14,
                            fontWeight: 700,
                            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            letterSpacing: '0.5px'
                          }}>
                            # {order.id.slice(-6).toUpperCase()}
                          </div>
                          <div style={{
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.4)',
                            marginTop: 3,
                            letterSpacing: '0.2px'
                          }}>
                            {formatDate(orderDate)}
                          </div>
                        </div>
                        <div style={{
                          padding: '3px 10px',
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
                      <div style={{ padding: isMobile ? '8px 14px' : '8px 16px', flex: 1 }}>
                        {order.items.map((item, index) => {
                          const displayName = item.cigarId.startsWith('FEE:')
                            ? t('eventsAdmin.eventFee')
                            : (item.name || item.cigarId)

                          return (
                            <div key={index} style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '7px 0',
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
                        padding: isMobile ? '10px 14px' : '10px 16px',
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(0,0,0,0.15)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          color: 'rgba(255,255,255,0.35)',
                          fontSize: 11
                        }}>
                          <ShoppingOutlined style={{ fontSize: 11 }} />
                          <span>{totalQuantity} {t('ordersAdmin.totalQuantity') || 'items'}</span>
                        </div>
                        <div style={{
                          fontSize: isMobile ? 15 : 16,
                          fontWeight: 700,
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
                  const recordDate = record.createdAt instanceof Date
                    ? record.createdAt
                    : (record.createdAt as any)?.toDate
                      ? (record.createdAt as any).toDate()
                      : new Date(record.createdAt)

                  const isEarn = record.type === 'earn'
                  const accentColor = isEarn ? '#52c41a' : '#ff4d4f'
                  const accentBg = isEarn ? 'rgba(82,196,26,0.06)' : 'rgba(255,77,79,0.06)'

                  return (
                    <div
                      key={record.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: isMobile ? 12 : 16,
                        padding: isMobile ? '12px 14px' : '13px 16px',
                        borderRadius: 10,
                        background: accentBg,
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderLeft: `3px solid ${accentColor}`,
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
                          {record.description}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.35)',
                          }}>
                            {formatDate(recordDate)}
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>•</span>
                          <span style={{
                            fontSize: 11,
                            padding: '1px 7px',
                            borderRadius: 10,
                            background: 'rgba(244,175,37,0.1)',
                            border: '1px solid rgba(244,175,37,0.2)',
                            color: 'rgba(244,175,37,0.8)',
                          }}>
                            {t(`pointsConfig.records.sources.${record.source}`) || record.source}
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
                    </div>
                  )
                })}
              </div>
            )
          )}

          {activeTab === 'activity' && (
            loadingEvents ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 36, color: '#F4AF25', marginBottom: 12 }}>
                  <CalendarOutlined spin />
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {t('common.loading')}
                </Text>
              </div>
            ) : userEvents.length === 0 ? (
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
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                gap: isMobile ? 12 : 16
              }}>
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
                    <div style={{ flex: 1, textAlign: 'center', padding: '16px 8px' }}>
                      <div style={{
                        fontSize: isMobile ? 22 : 26,
                        fontWeight: 800,
                        background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        lineHeight: 1,
                        marginBottom: 6
                      }}>
                        {stat.value}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.45)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}>
                        <span style={{ fontSize: 10, color: 'rgba(244,175,37,0.6)' }}>{stat.icon}</span>
                        {stat.label}
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
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
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
                        overflow: 'hidden'
                      }}>
                        {/* Card header with avatar */}
                        <div style={{
                          padding: isMobile ? '14px 14px 10px' : '16px 16px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          borderBottom: '1px solid rgba(255,255,255,0.06)'
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
                          <div style={{ flex: 1, minWidth: 0 }}>
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
                        </div>

                        {/* Info rows */}
                        <div style={{ padding: isMobile ? '10px 14px' : '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* Join date */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CalendarOutlined style={{ fontSize: 11, color: 'rgba(244,175,37,0.5)', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                              {t('profile.joinDate')}
                            </span>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginLeft: 'auto' }}>
                              {formatDate(joinDate)}
                            </span>
                          </div>

                          {/* Membership activation */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isMembershipActivated
                              ? <CheckCircleOutlined style={{ fontSize: 11, color: '#52c41a', flexShrink: 0 }} />
                              : <ClockCircleOutlined style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
                            }
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                              {t('profile.membership')}
                            </span>
                            {isMembershipActivated ? (
                              <span style={{
                                fontSize: 12, marginLeft: 'auto',
                                padding: '1px 8px', borderRadius: 10,
                                background: 'rgba(82,196,26,0.12)',
                                border: '1px solid rgba(82,196,26,0.3)',
                                color: '#52c41a'
                              }}>
                                {activatedAt ? formatDate(activatedAt) : t('profile.activatedMembership')}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 11, marginLeft: 'auto',
                                padding: '1px 8px', borderRadius: 10,
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.3)'
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
