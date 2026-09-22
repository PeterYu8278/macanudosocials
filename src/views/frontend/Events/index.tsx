// 活动页面
import React, { useMemo, useState } from 'react'
import { Typography, Button, Drawer, Empty, Spin, App } from 'antd'
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  NotificationOutlined,
  RightOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

import { getEvents, registerForEvent, unregisterFromEvent } from '../../../services/firebase/firestore'
import { getAnnouncements } from '../../../services/firebase/announcements'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useAuthStore } from '../../../store/modules/auth'
import type { Announcement, Event } from '../../../types'
import { useTranslation } from 'react-i18next'
import { hasPermission } from '../../../config/permissions'

const toDateOrNull = (value: any): Date | null => {
  if (!value) return null
  if (value?.toDate) return value.toDate()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDisplayDate = (value: unknown, language: string): string => {
  const date = toDateOrNull(value)
  if (!date) return '-'

  if (language.startsWith('zh')) {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}, ${date.getFullYear()}`
}

const formatDisplayTime = (value: unknown, language: string): string => {
  const date = toDateOrNull(value)
  if (!date) return '-'

  return date.toLocaleTimeString(language.startsWith('zh') ? 'zh-CN' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

const formatDisplayDateRange = (startValue: unknown, endValue: unknown, language: string): string => {
  const start = toDateOrNull(startValue)
  const end = toDateOrNull(endValue)
  if (!start || !end) return `${formatDisplayDate(start, language)} - ${formatDisplayDate(end, language)}`

  if (language.startsWith('zh')) {
    if (start.getFullYear() === end.getFullYear()) {
      return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`
    }
    return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()} - ${end.getFullYear()}/${end.getMonth() + 1}/${end.getDate()}`
  }

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} - ${end.getDate()} ${end.toLocaleString('en-US', { month: 'short' })} ${end.getFullYear()}`
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} ${start.toLocaleString('en-US', { month: 'short' })} - ${end.getDate()} ${end.toLocaleString('en-US', { month: 'short' })} ${end.getFullYear()}`
  }
  return `${formatDisplayDate(start, language)} - ${formatDisplayDate(end, language)}`
}

type FeedItem =
  | { kind: 'event'; id: string; date: Date; data: Event }
  | { kind: 'announcement'; id: string; date: Date; data: Announcement }

const Events: React.FC = () => {
  const { user } = useAuthStore()
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 991px)').matches : false
  const {
    data: allEvents,
    loading: eventsLoading,
    error: eventsError,
    refresh: refreshEvents
  } = useFirestoreQuery(getEvents)
  const {
    data: allAnnouncements,
    loading: announcementsLoading,
    error: announcementsError,
    refresh: refreshAnnouncements
  } = useFirestoreQuery(getAnnouncements)

  const events = useMemo(() => (allEvents ?? []).filter(event =>
    !event.isPrivate && event.status !== 'draft' && event.status !== 'cancelled'
  ), [allEvents])

  const announcements = useMemo(() => {
    const now = new Date()
    return (allAnnouncements ?? []).filter(announcement => {
      const publishedAt = toDateOrNull(announcement.publishedAt)
      const expiresAt = toDateOrNull(announcement.expiresAt)
      return announcement.status === 'published'
        && (!publishedAt || publishedAt <= now)
        && (!expiresAt || expiresAt >= now)
    })
  }, [allAnnouncements])

  const feedItems = useMemo<FeedItem[]>(() => {
    const eventItems: FeedItem[] = events.map(event => ({
      kind: 'event',
      id: event.id,
      date: toDateOrNull(event.schedule?.startDate) ?? new Date(0),
      data: event
    }))
    const announcementItems: FeedItem[] = announcements.map(announcement => ({
      kind: 'announcement',
      id: announcement.id,
      date: toDateOrNull(announcement.publishedAt) ?? toDateOrNull(announcement.createdAt) ?? new Date(0),
      data: announcement
    }))

    return [...eventItems, ...announcementItems].sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [events, announcements])

  const loading = eventsLoading || announcementsLoading
  const error = eventsError || announcementsError
  const refresh = () => {
    refreshEvents()
    refreshAnnouncements()
  }
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)

  const getDisplayStatus = (event: Event): 'upcoming' | 'ongoing' | 'completed' => {
    const now = new Date()
    const start = toDateOrNull(event.schedule?.startDate)
    const end = toDateOrNull(event.schedule?.endDate)
    if (end && now > end) return 'completed'
    if (start && now >= start) return 'ongoing'
    return 'upcoming'
  }

  const isRegistrationClosed = (event: Event): boolean => {
    const displayStatus = getDisplayStatus(event)

    return (
      displayStatus === 'completed' ||
      event.status === 'completed' ||
      event.status === 'cancelled' ||
      event.status === 'draft'
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

        {!loading && !error && feedItems.length === 0 && (
          <Empty
            description={<span style={{ color: 'rgba(255, 255, 255, 0.72)' }}>{t('events.noUpdates')}</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ gridColumn: '1 / -1', padding: '72px 16px' }}
          >
            <Button type="primary" onClick={refresh}>
              {t('common.retry')}
            </Button>
          </Empty>
        )}

        {feedItems.map((item) => {
          if (item.kind === 'announcement') {
            const announcement = item.data
            const typeColors = {
              info: '#3b82f6',
              warning: '#f59e0b',
              important: '#ef4444'
            }
            const accentColor = typeColors[announcement.type] ?? '#E7B54A'

            return (
              <article
                key={`announcement-${announcement.id}`}
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#1a1a1a',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                  transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.transform = 'translateY(-3px)'
                  event.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.55)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.transform = 'translateY(0)'
                  event.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'
                }}
              >
                {announcement.image && (
                  <div
                    role="img"
                    aria-label={announcement.title}
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: isMobile ? 151 : undefined,
                      aspectRatio: isMobile ? undefined : '16/9',
                      flexShrink: 0,
                      backgroundImage: `url("${announcement.image}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      padding: '2px 10px',
                      borderRadius: 99,
                      background: accentColor,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      backdropFilter: 'blur(4px)',
                    }}>
                      {t('announcements.label')}
                    </span>
                  </div>
                )}
                <div style={{
                  padding: isMobile ? '12px 14px 14px' : 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isMobile ? 7 : 9,
                }}>
                  <h2 style={{
                    margin: 0,
                    fontSize: 17,
                    lineHeight: 1.3,
                    fontWeight: 700,
                    backgroundImage: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                    WebkitBackgroundClip: 'text',
                    color: 'transparent',
                  }}>
                    {announcement.title}
                  </h2>
                  <p style={{
                    margin: 0,
                    color: 'rgba(255,255,255,0.68)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: isMobile ? 2 : 3,
                    overflow: 'hidden',
                  }}>
                    {announcement.content}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      <CalendarOutlined style={{ fontSize: 12 }} />
                      {formatDisplayDate(item.date, i18n.language || 'zh-CN')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedAnnouncement(announcement)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#FDE08D',
                        padding: '4px 0 4px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('events.viewMore', 'View More')}
                      <RightOutlined style={{ fontSize: 10 }} />
                    </button>
                  </div>
                </div>
              </article>
            )
          }

          const event = item.data
          const socialTag = getSocialRelationTag(event)
          const registeredIds = event.participants?.registered || []
          const isUserRegistered = user ? registeredIds.includes(user.id) : false
          const canCurrentUserRegister = user ? hasPermission(user.role, 'canRegisterEvent') : false
          const closed = isRegistrationClosed(event)
          const displayStatus = getDisplayStatus(event)

          const language = i18n.language || 'zh-CN'
          const startDate = toDateOrNull(event.schedule?.startDate)
          const endDate = toDateOrNull(event.schedule?.endDate)
          const formattedDateRange = formatDisplayDateRange(startDate, endDate, language)
          const formattedTimeRange = `${formatDisplayTime(startDate, language)} - ${formatDisplayTime(endDate, language)}`
          const venue = event.location?.name || event.location?.address || '-'
          const maxParticipants = event.participants?.maxParticipants || 0
          const availablePax = maxParticipants > 0
            ? Math.max(maxParticipants - registeredIds.length, 0)
            : null
          const visibleRegistrantIds = registeredIds.slice(0, isMobile ? 4 : 5)
          const currentUserAvatar = user?.profile?.avatar || user?.photoURL

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
                height: isMobile ? 151 : undefined,
                aspectRatio: isMobile ? undefined : '16/9',
                flexShrink: 0,
                backgroundImage: `url("${(event as any).imageUrl || (event as any).coverImage || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCHkrz9j7PM4w5oJ-Ev89VkzHjq_v56FKnoLokAM_pzgzM6iNfbhlUqD41_YlPuL4JuB_cB8FzngJx-Ha2y__35Q0NvH6BwubyOXdY9GvnvbwOpdZ6Edy1OyMJPkfG6-efD4YBYLZSO1BFlMu6u6T3Vujsd4rKIgWOwxgLHVkDsWwS72e271qwxZ4vothKhf_zW-CiGBhoIQQsvWO9zQCYJuVevXIVGOwLdkBIDO_b0EdZISgCxP0RGVW71K71lUAE_lwj27PQZiuVb'}"})`,
                backgroundSize: 'cover',
                ...(event.image ? { backgroundImage: `url("${event.image}")` } : {}),
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
                display: 'flex',
                flexDirection: 'column',
                padding: isMobile ? '12px 14px 13px' : '16px',
                gap: isMobile ? 6 : 8,
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.68)', fontSize: 13, minWidth: 0 }}>
                  <EnvironmentOutlined style={{ fontSize: 13, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{venue}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 4, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <CalendarOutlined style={{ fontSize: 12 }} />
                    {formattedDateRange}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <ClockCircleOutlined style={{ fontSize: 12 }} />
                    {formattedTimeRange}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: isMobile ? 26 : 30 }}>
                  <span style={{ color: '#FDE08D', fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap' }}>
                    {availablePax === null
                      ? t('events.availablePaxUnlimited')
                      : t('events.availablePax', { count: availablePax })}
                  </span>

                  {registeredIds.length > 0 && (
                    <div
                      aria-label={t('events.registrantCount', { count: registeredIds.length })}
                      title={t('events.registrantCount', { count: registeredIds.length })}
                      style={{ display: 'flex', alignItems: 'center', paddingLeft: 10 }}
                    >
                      {visibleRegistrantIds.map((participantId, index) => {
                        const avatarUrl = participantId === user?.id ? currentUserAvatar : undefined

                        return (
                          <span
                            key={participantId}
                            style={{
                              width: isMobile ? 26 : 30,
                              height: isMobile ? 26 : 30,
                              marginLeft: index === 0 ? 0 : isMobile ? -9 : -10,
                              borderRadius: '50%',
                              border: '2px solid #1a1a1a',
                              background: avatarUrl ? `url("${avatarUrl}") center/cover` : '#4a4337',
                              color: '#FDE08D',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              position: 'relative',
                              zIndex: visibleRegistrantIds.length - index,
                            }}
                          >
                            {!avatarUrl && <UserOutlined style={{ fontSize: isMobile ? 12 : 14 }} />}
                          </span>
                        )
                      })}
                      {registeredIds.length > visibleRegistrantIds.length && (
                        <span style={{
                          width: isMobile ? 26 : 30,
                          height: isMobile ? 26 : 30,
                          marginLeft: isMobile ? -9 : -10,
                          borderRadius: '50%',
                          border: '2px solid #1a1a1a',
                          background: '#C48D3A',
                          color: '#111',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 800,
                          position: 'relative',
                        }}>
                          +{registeredIds.length - visibleRegistrantIds.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Button row */}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
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
                      padding: isMobile ? '6px 0' : '7px 0',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: closed ? 'not-allowed' : 'pointer',
                      transition: 'opacity 0.2s',
                    }}
                    onClick={async () => {
                      if (!user) { message.info(t('auth.pleaseLogin')); return }
                      if (closed) { message.warning(getRegistrationClosedText(event)); return }
                      if (!isUserRegistered && !canCurrentUserRegister) {
                        message.warning(t('common.noPermission')); return
                      }
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

      <Drawer
        placement="bottom"
        open={Boolean(selectedAnnouncement)}
        onClose={() => setSelectedAnnouncement(null)}
        height={isMobile ? '78vh' : 560}
        title={(
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FDE08D' }}>
            <NotificationOutlined />
            {t('announcements.label')}
          </span>
        )}
        styles={{
          header: {
            background: '#171612',
            borderBottom: '1px solid rgba(244,175,37,0.25)',
          },
          body: {
            padding: 0,
            background: '#171612',
          },
          content: {
            background: '#171612',
            borderTop: '1px solid rgba(244,175,37,0.35)',
            borderRadius: '12px 12px 0 0',
          },
        }}
      >
        {selectedAnnouncement && (
          <article style={{ width: '100%', maxWidth: 720, margin: '0 auto', paddingBottom: 32 }}>
            {selectedAnnouncement.image && (
              <img
                src={selectedAnnouncement.image}
                alt={selectedAnnouncement.title}
                style={{
                  width: '100%',
                  height: isMobile ? 190 : 260,
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            )}
            <div style={{ padding: isMobile ? '18px 16px' : '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#FDE08D', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                  {t(`announcements.${selectedAnnouncement.type}`)}
                </span>
                {selectedAnnouncement.pinned && (
                  <span style={{ color: '#FDE08D', fontSize: 12 }}>{t('announcements.pinned')}</span>
                )}
              </div>
              <h2 style={{ margin: 0, color: '#fff', fontSize: isMobile ? 22 : 26, lineHeight: 1.3 }}>
                {selectedAnnouncement.title}
              </h2>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                {selectedAnnouncement.content}
              </p>
              <div style={{ display: 'grid', gap: 8, paddingTop: 4, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CalendarOutlined />
                  {t('announcements.publishedAt')}: {formatDisplayDate(selectedAnnouncement.publishedAt, i18n.language || 'zh-CN')}
                </span>
                {selectedAnnouncement.expiresAt && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ClockCircleOutlined />
                    {t('announcements.expiresAt')}: {formatDisplayDate(selectedAnnouncement.expiresAt, i18n.language || 'zh-CN')}
                  </span>
                )}
              </div>
            </div>
          </article>
        )}
      </Drawer>
    </div>
  )
}

export default Events
