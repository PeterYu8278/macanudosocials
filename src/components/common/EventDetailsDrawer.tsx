import React from 'react'
import { Drawer } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/modules/auth'
import type { Event } from '../../types'
import { toDateOrNull, formatDisplayDate, formatDisplayTime, formatDisplayDateRange } from '../../utils/eventDisplay'

interface EventDetailsDrawerProps {
  event: Event | null
  isMobile: boolean
  imageUrl: string
  statusText: string
  closed: boolean
  closedText: string
  loading: boolean
  onClose: () => void
  onRegister: (event: Event) => Promise<void>
}

export default function EventDetailsDrawer({
  event, isMobile, imageUrl, statusText, closed, closedText, loading, onClose, onRegister,
}: EventDetailsDrawerProps) {
  const { t, i18n } = useTranslation()
  const user = useAuthStore(state => state.user)
  const language = i18n.language || 'zh-CN'
  const registeredIds = event?.participants?.registered || []
  const isUserRegistered = !!user && registeredIds.includes(user.id)
  const eventFee = event?.participants?.fee ?? 0

  return (
    <Drawer
      placement="bottom"
      open={Boolean(event)}
      onClose={onClose}
      height={isMobile ? '86dvh' : 680}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FDE08D' }}><CalendarOutlined />{t('events.eventDetails')}</span>}
      styles={{
        header: { background: '#171612', borderBottom: '1px solid rgba(244,175,37,0.25)' },
        body: { padding: 0, background: '#171612' },
        content: { background: '#171612', borderTop: '1px solid rgba(244,175,37,0.35)', borderRadius: '12px 12px 0 0' },
        footer: { background: '#171612', borderTop: '1px solid rgba(244,175,37,0.25)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' },
      }}
      footer={event ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: 788, margin: '0 auto' }}>
          <div style={{ flexShrink: 0 }}>
            <span style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{t('events.fee')}</span>
            <strong style={{ color: '#FDE08D', fontSize: 18 }}>{eventFee > 0 ? `RM ${eventFee.toFixed(2)}` : (language.startsWith('zh') ? '免费' : 'Free')}</strong>
          </div>
                <button
                  type="button"
                  disabled={closed || loading}
                  onClick={() => onRegister(event)}
                  style={{
                    flex: 1,
                    minWidth: 0,
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
                    padding: '11px 0',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: closed ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading
                    ? t('events.processing')
                    : closed
                      ? closedText
                      : !user
                        ? t('auth.pleaseLogin')
                        : isUserRegistered
                          ? t('events.leave')
                          : t('events.join')}
                </button>
        </div>
      ) : null}
    >
      {event && (() => {
        const startDate = toDateOrNull(event.schedule?.startDate)
        const endDate = toDateOrNull(event.schedule?.endDate)
        const registrationDeadline = toDateOrNull(event.schedule?.registrationDeadline)
        const maxParticipants = event.participants?.maxParticipants || 0
        const availablePax = maxParticipants > 0 ? Math.max(maxParticipants - registeredIds.length, 0) : null
        const venue = event.location?.name || event.location?.address || '-'
        return (
            <article style={{ width: '100%', maxWidth: 820, margin: '0 auto', paddingBottom: 16 }}>
              <div style={{
                width: '100%',
                aspectRatio: '2/1',
                background: '#0d0d0d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}>
                <img
                  src={imageUrl}
                  alt={event.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>

              <div style={{ padding: isMobile ? '18px 16px' : '24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: '#FDE08D', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                      {statusText}
                    </span>
                    <h2 style={{ margin: '8px 0 0', color: '#fff', fontSize: isMobile ? 24 : 30, lineHeight: 1.25 }}>
                      {event.title}
                    </h2>
                  </div>
                  <span style={{ color: '#FDE08D', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {availablePax === null
                      ? t('events.availablePaxUnlimited')
                      : t('events.availablePax', { count: availablePax })}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
                }}>
                  <div style={{ display: 'flex', gap: 10, color: 'rgba(255,255,255,0.78)' }}>
                    <CalendarOutlined style={{ color: '#FDE08D', marginTop: 3 }} />
                    <span>
                      <strong style={{ display: 'block', color: '#fff', marginBottom: 3 }}>{t('events.eventTime')}</strong>
                      {formatDisplayDateRange(startDate, endDate, language)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, color: 'rgba(255,255,255,0.78)' }}>
                    <ClockCircleOutlined style={{ color: '#FDE08D', marginTop: 3 }} />
                    <span>
                      <strong style={{ display: 'block', color: '#fff', marginBottom: 3 }}>{t('events.startTime')} / {t('events.endTime')}</strong>
                      {formatDisplayTime(startDate, language)} - {formatDisplayTime(endDate, language)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, color: 'rgba(255,255,255,0.78)' }}>
                    <EnvironmentOutlined style={{ color: '#FDE08D', marginTop: 3 }} />
                    <span>
                      <strong style={{ display: 'block', color: '#fff', marginBottom: 3 }}>{t('events.location')}</strong>
                      {venue}
                      {event.location?.address && event.location.address !== venue && (
                        <span style={{ display: 'block', color: 'rgba(255,255,255,0.58)', marginTop: 3 }}>
                          {event.location.address}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, color: 'rgba(255,255,255,0.78)' }}>
                    <UserOutlined style={{ color: '#FDE08D', marginTop: 3 }} />
                    <span>
                      <strong style={{ display: 'block', color: '#fff', marginBottom: 3 }}>{t('events.registration')}</strong>
                      {registeredIds.length}{maxParticipants > 0 ? ` / ${maxParticipants}` : ''} {t('events.people')}
                    </span>
                  </div>

                  {registrationDeadline && (
                    <div style={{ display: 'flex', gap: 10, color: 'rgba(255,255,255,0.78)' }}>
                      <ClockCircleOutlined style={{ color: '#FDE08D', marginTop: 3 }} />
                      <span>
                        <strong style={{ display: 'block', color: '#fff', marginBottom: 3 }}>
                          {t('events.registrationDeadline', 'Registration Deadline')}
                        </strong>
                        {formatDisplayDate(registrationDeadline, language)} {formatDisplayTime(registrationDeadline, language)}
                      </span>
                    </div>
                  )}
                </div>

                {event.description && (
                  <p style={{ margin: 0, color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                    {event.description}
                  </p>
                )}


              </div>
            </article>
        )
      })()}
    </Drawer>
  )
}
