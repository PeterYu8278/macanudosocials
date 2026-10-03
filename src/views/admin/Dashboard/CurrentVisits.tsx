import { useEffect, useState } from 'react'
import { Alert, Empty, Spin, Tag } from 'antd'
import { ArrowRightOutlined, ClockCircleOutlined, TeamOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { useAuthStore } from '../../../store/modules/auth'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { getAllStores } from '../../../services/firebase/stores'
import { subscribeToPendingVisitSessions } from '../../../services/firebase/visitSessions'
import { getRedemptionRecordsBySession, subscribeToRedemptionRecordsBySession } from '../../../services/firebase/redemption'
import type { Cigar, RedemptionRecord, User, VisitSession } from '../../../types'
import { canAccessRoute } from '../../../config/permissions'

const CurrentVisitRow = ({ session, users, cigars, storeName, now }: {
  session: VisitSession
  users: User[]
  cigars: Cigar[]
  storeName: string
  now: number
}) => {
  const { t } = useTranslation()
  const [records, setRecords] = useState<RedemptionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    let revision = 0
    setRecords([])
    setLoading(true)
    setError(false)
    const unsubscribe = subscribeToRedemptionRecordsBySession(session.id, () => {
      const request = ++revision
      getRedemptionRecordsBySession(session.id).then(result => {
        if (!active || request !== revision) return
        setRecords(result)
        setLoading(false)
        setError(false)
      }).catch(() => {
        if (!active || request !== revision) return
        setLoading(false)
        setError(true)
      })
    }, () => {
      if (!active) return
      revision += 1
      setLoading(false)
      setError(true)
    })
    return () => { active = false; unsubscribe() }
  }, [session.id])

  const member = users.find(entry => entry.id === session.userId)
  const minutes = Math.max(0, Math.floor((now - session.checkInAt.getTime()) / 60000))

  return (
    <div className="dashboard-current-visit" role="row">
      <div role="cell" className="dashboard-current-member">
        <strong>{member?.displayName || session.userName || t('dashboard.unknownUser')}</strong>
        <span>{storeName || session.storeName || '-'}</span>
      </div>
      <div role="cell" className="dashboard-current-time">
        <span>{dayjs(session.checkInAt).format('D MMM YYYY')}</span>
        <span>{dayjs(session.checkInAt).format('HH:mm')}</span>
      </div>
      <div role="cell" className="dashboard-current-duration">
        <ClockCircleOutlined /> {Math.floor(minutes / 60)} H {minutes % 60}m
      </div>
      <div role="cell" className="dashboard-current-redemptions">
        {loading ? <Spin size="small" /> : error ? (
          <span>{t('visitSessions.loadRedemptionRecordsFailed')}</span>
        ) : records.length === 0 ? (
          <span className="dashboard-current-muted">{t('visitSessions.noRedemptionRecords')}</span>
        ) : records.map(record => (
          <div key={record.id} className="dashboard-current-redemption">
            <span>{record.status === 'pending'
              ? t('visitSessions.statusToSelect')
              : cigars.find(cigar => cigar.id === record.cigarId)?.name || record.cigarName || '-'}</span>
            <strong>x{record.quantity}</strong>
            <Tag color={record.status === 'pending' ? 'orange' : 'green'}>
              {record.status === 'pending' ? t('visitSessions.statusToSelect') : t('visitSessions.statusCompleted')}
            </Tag>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CurrentVisits({ users, cigars }: { users: User[]; cigars: Cigar[] }) {
  const { t } = useTranslation()
  const { user, isSuperAdmin } = useAuthStore()
  const { data: stores } = useFirestoreQuery(getAllStores)
  const [sessions, setSessions] = useState<VisitSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    setSessions([])
    setError(false)
    if (!user || (!isSuperAdmin && !user.storeId)) {
      setLoading(false)
      return
    }
    setLoading(true)
    return subscribeToPendingVisitSessions(isSuperAdmin ? undefined : user.storeId, result => {
      setSessions(result)
      setLoading(false)
      setError(false)
    }, () => {
      setError(true)
      setLoading(false)
    })
  }, [isSuperAdmin, user?.id, user?.storeId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="dashboard-current-visits" aria-label={t('dashboard.currentVisits')}>
      <div className="dashboard-current-visits-heading">
        <h2><TeamOutlined /> {t('dashboard.currentVisits')} <span>{sessions.length}</span></h2>
        {user && canAccessRoute(user.role, '/admin/visit-sessions') && <Link to="/admin/visit-sessions">{t('dashboard.manageVisits')} <ArrowRightOutlined /></Link>}
      </div>
      {loading ? <div className="dashboard-current-visits-empty"><Spin /></div>
        : error ? <Alert type="error" showIcon message={t('dashboard.currentVisitsLoadFailed')} />
        : sessions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noCurrentVisits')} />
        : <div role="table" aria-label={t('dashboard.currentVisits')}>
          <div role="row" className="dashboard-current-visit dashboard-current-visit-header">
            <span role="columnheader">{t('visitSessions.user')}</span>
            <span role="columnheader">{t('visitSessions.checkInTime')}</span>
            <span role="columnheader">{t('visitSessions.duration')}</span>
            <span role="columnheader">{t('visitSessions.redemptionRecords')}</span>
          </div>
          {sessions.map(session => <CurrentVisitRow key={session.id} session={session} users={users} cigars={cigars}
            storeName={stores.find(store => store.id === session.storeId)?.name || ''} now={now} />)}
        </div>}
    </section>
  )
}
