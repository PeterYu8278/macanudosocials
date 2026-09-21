// 活动页面
import React, { useMemo, useState } from 'react'
import { Typography, Button, Empty, Spin, App } from 'antd'
import { CalendarOutlined, TeamOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

import { getEvents, registerForEvent, unregisterFromEvent } from '../../../services/firebase/firestore'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useAuthStore } from '../../../store/modules/auth'
import type { Event } from '../../../types'
import { useTranslation } from 'react-i18next'

const toDateOrNull = (value: any): Date | null => {
  if (!value) return null
  if (value?.toDate) return value.toDate()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const Events: React.FC = () => {
  const { user } = useAuthStore()
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 991px)').matches : false
  const { data: allEvents, loading, error, refresh } = useFirestoreQuery(getEvents)
  const events = (allEvents ?? []).filter(event =>
    !event.isPrivate && event.status !== 'draft' && event.status !== 'cancelled'
  )
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const getDisplayStatus = (event: Event): 'upcoming' | 'ongoing' | 'completed' => {
    const now = new Date()
    const start = toDateOrNull(event.schedule?.startDate)
    const end = toDateOrNull(event.schedule?.endDate)
    if (end && now > end) return 'completed'
    if (start && now >= start) return 'ongoing'
    return 'upcoming'
  }

  const isRegistrationClosed = (event: Event): boolean => {
    const now = new Date()
    const displayStatus = getDisplayStatus(event)
    const registrationDeadline = toDateOrNull(event.schedule?.registrationDeadline)

    return (
      displayStatus === 'completed' ||
      event.status === 'completed' ||
      event.status === 'cancelled' ||
      event.status === 'draft' ||
      !!(registrationDeadline && now > registrationDeadline)
    )
  }

  const getRegistrationClosedText = (event: Event): string => {
    return getDisplayStatus(event) === 'completed' || event.status === 'completed'
      ? t('events.completed')
      : t('events.registrationClosed')
  }

  // 获取所有已完成的活动，用于计算社交关系
  const completedEvents = useMemo(() => {
    return events.filter(e => getDisplayStatus(e) === 'completed')
  }, [events])

  // 计算参与者社交关系（基于当前登录用户）
  const getSocialRelationTag = (event: Event): { color: string } | null => {
    // 如果没有登录用户，不显示 tag
    if (!user || !user.id) {
      return null
    }

    const currentParticipants = (event?.participants?.registered || []) as string[]

    // 检查当前登录用户是否参与了当前活动
    const isUserParticipating = currentParticipants.includes(user.id)

    // 如果用户没有参与当前活动，不显示 tag
    if (!isUserParticipating) {
      return null
    }

    // 找出当前登录用户参与过的所有已完成活动
    const userCompletedEvents = completedEvents.filter(completedEvent => {
      const completedParticipants = (completedEvent?.participants?.registered || []) as string[]
      return completedParticipants.includes(user.id)
    })

    // 如果没有参与过任何已完成的活动，不显示 tag
    if (userCompletedEvents.length === 0) {
      return null
    }

    // 从用户参与过的已完成活动中，收集所有其他参与者（排除用户自己）
    const familiarParticipants = new Set<string>()
    for (const completedEvent of userCompletedEvents) {
      const completedParticipants = (completedEvent?.participants?.registered || []) as string[]
      for (const participantId of completedParticipants) {
        // 排除用户自己
        if (participantId !== user.id) {
          familiarParticipants.add(participantId)
        }
      }
    }

    // 在当前活动的参与者中，找出这些"共同参与者"（排除用户自己）
    const commonParticipants = currentParticipants.filter(id =>
      id !== user.id && familiarParticipants.has(id)
    )
    const overlapCount = commonParticipants.length

    // 如果没有找到任何共同参与者，不显示 tag
    if (overlapCount === 0) {
      return null
    }

    // 根据共同参与者人数返回不同颜色
    // < 5 人：青色 (cyan) - 较弱的个人社交关系
    // >= 5 人：橙色 (orange) - 较强的个人社交关系
    const tagColor = overlapCount < 5 ? '#13c2c2' : '#ff7a00'

    return { color: tagColor }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'upcoming': return 'blue'
      case 'ongoing': return 'green'
      case 'completed': return 'default'
      default: return 'default'
    }
  }

  const getStatusText = (event: Event) => {
    const display = getDisplayStatus(event)
    switch (display) {
      case 'upcoming': return t('events.upcoming')
      case 'ongoing': return t('events.ongoing')
      case 'completed': return t('events.completed')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      paddingBottom: isMobile ? '60px' : '0' // 移动端添加底部间距，避免被底部导航遮挡
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1px',
        background: 'transparent',
        backdropFilter: 'blur(10px)'
      }}>

      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
        gap: '24px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {loading && (
          <div
            role="status"
            aria-live="polite"
            style={{
              gridColumn: '1 / -1',
              minHeight: '240px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FDE08D'
            }}
          >
            <Spin tip={t('common.loading')} />
          </div>
        )}

        {!loading && error && (
          <div style={{
            gridColumn: '1 / -1',
            minHeight: '240px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '24px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.82)'
          }}>
            <Text style={{ color: 'rgba(255, 255, 255, 0.82)' }}>{t('common.loadFailed')}</Text>
            <Button type="primary" onClick={refresh}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <Empty
            description={<span style={{ color: 'rgba(255, 255, 255, 0.72)' }}>{t('events.noEvents')}</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ gridColumn: '1 / -1', padding: '72px 16px' }}
          >
            <Button type="primary" onClick={refresh}>
              {t('common.retry')}
            </Button>
          </Empty>
        )}

        {events.map((event) => {
          const socialTag = getSocialRelationTag(event)
          const registeredIds = event.participants?.registered || []
          const isUserRegistered = user ? registeredIds.includes(user.id) : false
          const closed = isRegistrationClosed(event)
          const displayStatus = getDisplayStatus(event)

          const formattedDate = (() => {
            const d = (event as any)?.schedule?.startDate as any
            const dateVal = d?.toDate ? d.toDate() : d
            if (!dateVal) return '-'
            const dateObj = new Date(dateVal)
            const currentLang = i18n.language || 'zh-CN'
            if (currentLang === 'zh-CN') {
              return dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
            }
            return `${dateObj.getDate()} ${dateObj.toLocaleString('en-US', { month: 'short' })}, ${dateObj.getFullYear()}`
          })()

          const statusColors: Record<string, string> = {
            upcoming: '#3b82f6',
            ongoing: '#22c55e',
            completed: 'rgba(255,255,255,0.35)',
          }
          const statusColor = statusColors[displayStatus] ?? 'rgba(255,255,255,0.35)'

          return (
            <div
              key={event.id}
              style={{
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                background: '#1a1a1a',
                transition: 'transform 0.25s ease, box-shadow 0.25s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.55)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'
              }}
            >
              {/* Hero image */}
              <div style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16/9',
                flexShrink: 0,
                backgroundImage: `url("${(event as any).imageUrl || (event as any).coverImage || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCHkrz9j7PM4w5oJ-Ev89VkzHjq_v56FKnoLokAM_pzgzM6iNfbhlUqD41_YlPuL4JuB_cB8FzngJx-Ha2y__35Q0NvH6BwubyOXdY9GvnvbwOpdZ6Edy1OyMJPkfG6-efD4YBYLZSO1BFlMu6u6T3Vujsd4rKIgWOwxgLHVkDsWwS72e271qwxZ4vothKhf_zW-CiGBhoIQQsvWO9zQCYJuVevXIVGOwLdkBIDO_b0EdZISgCxP0RGVW71K71lUAE_lwj27PQZiuVb'}"})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}>
                {/* Status badge */}
                <span style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  background: statusColor,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 10px',
                  borderRadius: 99,
                  letterSpacing: '0.04em',
                  backdropFilter: 'blur(4px)',
                }}>
                  {getStatusText(event)}
                </span>
                {/* Social dot */}
                {socialTag && (
                  <span style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: socialTag.color,
                    boxShadow: `0 0 6px ${socialTag.color}`,
                  }} />
                )}
              </div>

              {/* Details */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                gap: 8,
              }}>
                <h2 style={{
                  fontSize: 17,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  margin: 0,
                  backgroundImage: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                }}>
                  {event.title}
                </h2>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                  <CalendarOutlined style={{ fontSize: 12 }} />
                  <span>{formattedDate}</span>
                </div>

                {registeredIds.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    <TeamOutlined style={{ fontSize: 12 }} />
                    <span>{registeredIds.length} {t('events.registered')}</span>
                  </div>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Button row */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: 'rgba(255,255,255,0.75)',
                      borderRadius: 8,
                      padding: '7px 0',
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'border-color 0.2s, color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#FDE08D'
                      e.currentTarget.style.color = '#FDE08D'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                      e.currentTarget.style.color = 'rgba(255,255,255,0.75)'
                    }}
                    onClick={() => {
                      message.info(t('events.viewMoreComingSoon', 'Coming soon'))
                    }}
                  >
                    {t('events.viewMore', 'View More')}
                    <RightOutlined style={{ fontSize: 10 }} />
                  </button>

                  <button
                    type="button"
                    disabled={closed || loadingId === event.id}
                    style={{
                      flex: 1,
                      background: closed
                        ? 'rgba(255,255,255,0.08)'
                        : isUserRegistered
                          ? 'rgba(239,68,68,0.15)'
                          : 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      border: closed
                        ? '1px solid rgba(255,255,255,0.1)'
                        : isUserRegistered
                          ? '1px solid rgba(239,68,68,0.4)'
                          : 'none',
                      color: closed
                        ? 'rgba(255,255,255,0.35)'
                        : isUserRegistered
                          ? '#f87171'
                          : '#111',
                      borderRadius: 8,
                      padding: '7px 0',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: closed ? 'not-allowed' : 'pointer',
                      transition: 'opacity 0.2s',
                    }}
                    onClick={async () => {
                      if (!user) { message.info(t('auth.pleaseLogin')); return }
                      if (closed) { message.warning(getRegistrationClosedText(event)); return }
                      const max = (event as any)?.participants?.maxParticipants || 0
                      if (!isUserRegistered && max > 0 && registeredIds.length >= max) {
                        message.warning(t('events.fullCapacity')); return
                      }
                      try {
                        setLoadingId(event.id)
                        const res = isUserRegistered
                          ? await unregisterFromEvent(event.id, user.id)
                          : await registerForEvent(event.id, user.id)
                        if (res.success) {
                          message.success(isUserRegistered ? t('events.unregistered') : t('events.registered'))
                          refresh()
                        } else {
                          message.error(res.error?.message || t('messages.operationFailed'))
                        }
                      } finally {
                        setLoadingId(null)
                      }
                    }}
                  >
                    {loadingId === event.id
                      ? t('events.processing')
                      : closed
                        ? getRegistrationClosedText(event)
                        : !user
                          ? t('auth.pleaseLogin')
                          : isUserRegistered
                            ? t('events.leave')
                            : t('events.join')}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Events
