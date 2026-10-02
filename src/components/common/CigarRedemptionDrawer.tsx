import { useEffect, useState, type CSSProperties } from 'react'
import { Drawer, Spin, Tag } from 'antd'
import { CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined, TeamOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { getDocument } from '../../services/firebase/firestore'
import type { Event, Order, VisitSession } from '../../types'
import type { CigarRedemptionGroup } from '../../utils/cigarRedemptionGroups'

interface Props {
  group: CigarRedemptionGroup | null
  onClose: () => void
  rootStyle: CSSProperties
  isMobile: boolean
  formatDateTime: (value: unknown) => string
  formatVisitPeriod: (session?: VisitSession) => string | null
}

interface RedemptionContext {
  session: VisitSession | null
  event: Event | null
}

export const CigarRedemptionDrawer = ({ group, onClose, rootStyle, isMobile, formatDateTime, formatVisitPeriod }: Props) => {
  const { t } = useTranslation()
  const [contexts, setContexts] = useState<Record<string, RedemptionContext>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    setContexts({})
    if (!group) return
    setLoading(true)
    const sessionIds = [...new Set(group.records
      .filter(record => record.type !== 'referral_reward')
      .map(record => record.visitSessionId).filter(Boolean))]
    void Promise.all(sessionIds.map(async id => {
      const session = await getDocument<VisitSession>('visitSessions', id)
      const order = session?.orderId ? await getDocument<Order>('orders', session.orderId) : null
      const eventId = order?.source?.eventId
      const event = eventId ? await getDocument<Event>('events', eventId) : null
      return [id, { session, event }] as const
    })).then(entries => {
      if (active) setContexts(Object.fromEntries(entries))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [group])

  return (
    <Drawer
      title={t('profile.cigarRecordDetails')}
      placement="bottom"
      open={Boolean(group)}
      onClose={onClose}
      rootStyle={rootStyle}
      zIndex={2100}
      height="auto"
      styles={{
        wrapper: { maxHeight: 'calc(100dvh - 24px)' },
        content: { background: '#181611', maxHeight: 'calc(100dvh - 24px)' },
        header: { borderBottom: '1px solid rgba(244,175,37,0.25)', flexShrink: 0 },
        body: { padding: 0, minHeight: 0, overflow: 'hidden', display: 'flex' },
      }}
    >
      {group && (
        <div style={{ color: '#fff', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 12, padding: isMobile ? 16 : 24, borderBottom: '1px solid rgba(244,175,37,0.2)', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {group.cigarName || t('profile.unknownCigar')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#aaa', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <span>{t('profile.redeemed')} <strong style={{ color: '#f4cf72', fontSize: 16, marginLeft: 4 }}>x{group.completedQuantity}</strong></span>
              {group.pendingQuantity > 0 && <span>{t('profile.pendingRedemption')} <strong style={{ color: '#f4cf72', marginLeft: 4 }}>x{group.pendingQuantity}</strong></span>}
            </div>
          </div>
          {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div> : (
            <div style={{ minHeight: 0, overflowY: 'auto', padding: isMobile ? '0 16px 16px' : '0 24px 24px' }}>
              {group.records.map(record => {
                const context = contexts[record.visitSessionId]
                const session = context?.session
                const event = context?.event
                return (
                  <div key={`${record.visitSessionId}-${record.id}`} style={{ borderBottom: '1px solid rgba(244,175,37,0.14)', padding: '14px 0' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 12, lineHeight: 1.5 }}>{formatDateTime(record.redeemedAt)}</span>
                      <Tag color={record.status === 'completed' ? 'green' : 'gold'} style={{ margin: 0, flexShrink: 0, fontSize: 11 }}>
                        {t(record.status === 'completed' ? 'profile.redeemed' : 'profile.pendingRedemption')}
                      </Tag>
                      <span style={{ color: '#f4cf72', fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', minWidth: 24, textAlign: 'right' }}>x{record.quantity}</span>
                    </div>
                    {record.type === 'referral_reward' ? (
                      <div style={{ color: '#aaa', fontSize: 12 }}><TeamOutlined style={{ marginRight: 8 }} />{t('profile.referralReward')}</div>
                    ) : session ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr)', gap: '6px 8px', fontSize: 12, lineHeight: 1.5 }}>
                        <EnvironmentOutlined style={{ color: '#b29454', paddingTop: 3 }} />
                        <span style={{ color: '#ddd', overflowWrap: 'anywhere' }}>{session.storeName || t('profile.lounge')}</span>
                        <ClockCircleOutlined style={{ color: '#888', paddingTop: 3 }} />
                        <span style={{ color: '#aaa', overflowWrap: 'anywhere' }}>{formatVisitPeriod(session) || formatDateTime(session.checkInAt)}</span>
                        {session.status !== 'completed' && <span style={{ gridColumn: 2, color: '#f4cf72', fontSize: 11 }}>
                          {t(`visitSessions.status${session.status.charAt(0).toUpperCase()}${session.status.slice(1)}`)}
                        </span>}
                      </div>
                    ) : (
                      <div style={{ color: '#aaa', fontSize: 12 }}>{t('profile.visitDetailsUnavailable')}</div>
                    )}
                    {event && (
                      <div style={{ display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr)', gap: '6px 8px', fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
                        <CalendarOutlined style={{ color: '#b29454', paddingTop: 3 }} />
                        <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{event.title}</span>
                        <span style={{ gridColumn: 2, color: '#aaa', overflowWrap: 'anywhere' }}>
                          {formatDateTime(event.schedule.startDate)} - {formatDateTime(event.schedule.endDate)}
                        </span>
                        <span style={{ gridColumn: 2, color: '#aaa', overflowWrap: 'anywhere' }}>{event.location.name}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
