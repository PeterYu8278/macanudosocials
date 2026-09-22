import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import type { Event } from '../../types'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/modules/auth'
import { CalendarOutlined, DollarCircleOutlined, EditOutlined, EnvironmentOutlined, LineChartOutlined, PictureOutlined, TeamOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

interface EventCardProps {
  event: Event
  onView: (event: Event) => void
  getStatusText: (status: string) => string
  getStatusColor: (status: string) => string
  completedEvents?: Event[] // 已完成的活动列表，用于计算社交关系
  revenue?: number // 活动总收入
  profit?: number // 活动净利润
}

const EventCard: React.FC<EventCardProps> = ({
  event,
  onView,
  getStatusText,
  getStatusColor,
  completedEvents = [],
  revenue = 0,
  profit = 0
}) => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const eventImage = event.image || (event as any).imageUrl || event.coverImage || ''
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [eventImage])

  // 计算参与者社交关系（基于当前登录用户）
  const getSocialRelationTag = (): { color: string } | null => {
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

  const socialTag = getSocialRelationTag()

  return (
    <div style={{ 
      position: 'relative', 
      overflow: 'hidden', 
      border: '1px solid rgba(244,175,37,0.2)', 
      borderRadius: 10
    }}>
      <div style={{ 
        position: 'absolute', 
        inset: 0, 
        background: 'linear-gradient(135deg, rgba(17,17,17,0.6), rgba(34,34,34,0.2))' 
      }} />
      <div style={{ 
        position: 'relative', 
        padding: 10,
        display: 'flex', 
        gap: 10
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          gap: 10,
          alignItems: 'stretch',
          width: '100%',
          minWidth: 0
        }}>
          <div style={{ 
            width: 82,
            height: 82,
            borderRadius: 8,
            border: '1px solid rgba(244,175,37,0.35)',
            overflow: 'hidden', 
            flexShrink: 0, 
            background: 'rgba(255,255,255,0.08)' 
          }}>
            {eventImage && !imageFailed ? (
              <img
                alt={event.title}
                src={eventImage}
                onError={() => setImageFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                aria-label={t('events.noImage', { defaultValue: 'No event image' })}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(244,175,37,0.65)',
                  background: 'rgba(244,175,37,0.06)'
                }}
              >
                <PictureOutlined style={{ fontSize: 30 }} />
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {event.title}
                {socialTag && (
                  <span style={{ width: 7, height: 7, marginLeft: 6, borderRadius: '50%', background: socialTag.color, display: 'inline-block' }} />
                )}
              </div>
              <span style={{ 
                fontSize: 11,
                padding: '2px 7px',
                borderRadius: 9999, 
                background: event.status === 'published' ? 'rgba(34,197,94,0.2)' : 
                           event.status === 'ongoing' ? 'rgba(56,189,248,0.2)' : 
                           event.status === 'completed' ? 'rgba(148,163,184,0.2)' : 
                           'rgba(244,63,94,0.2)', 
                color: event.status === 'published' ? '#34d399' : 
                       event.status === 'ongoing' ? '#38bdf8' : 
                       event.status === 'completed' ? '#94a3b8' : 
                       '#f87171', 
                flexShrink: 0 
              }}>
                {getStatusText(event.status)}
              </span>
              <Tooltip title={t('common.edit')}>
                <button
                  aria-label={t('common.edit')}
                  title={t('common.edit')}
                  onClick={() => onView(event)}
                  style={{
                    width: 28,
                    height: 28,
                    padding: 0,
                    borderRadius: 6,
                    border: 'none',
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    color: '#221c10',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  <EditOutlined />
                </button>
              </Tooltip>
            </div>

            {(() => {
              const start = (event as any)?.schedule?.startDate
              const end = (event as any)?.schedule?.endDate
              const startDate = (start as any)?.toDate ? (start as any).toDate() : start
              const endDate = (end as any)?.toDate ? (end as any).toDate() : end
              const time = startDate && endDate
                ? `${dayjs(startDate).format('DD MMM, HH:mm')}-${dayjs(endDate).format('HH:mm')}`
                : '-'
              const location = (event as any)?.location?.name || '-'
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.72)', fontSize: 11, minWidth: 0 }}>
                    <span style={{ color: '#f4af25', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <TeamOutlined /> {((event as any)?.participants?.registered || []).length}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <CalendarOutlined /> {time}
                    </span>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <EnvironmentOutlined /> {location}
                  </div>
                </>
              )
            })()}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, fontWeight: 700 }}>
              <Tooltip title={t('participants.totalRevenue')}>
                <span style={{ color: '#52c41a', whiteSpace: 'nowrap' }}>
                  <DollarCircleOutlined /> RM{revenue.toFixed(2)}
                </span>
              </Tooltip>
              <Tooltip title={t('participants.totalProfit')}>
                <span style={{ color: '#40a9ff', whiteSpace: 'nowrap' }}>
                  <LineChartOutlined /> RM{profit.toFixed(2)}
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EventCard
