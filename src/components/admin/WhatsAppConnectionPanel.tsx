import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Modal, Space, Spin, Tag, Typography } from 'antd'
import { CheckCircleOutlined, LinkOutlined, QrcodeOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { whatsappRequest } from '../../services/api/whatsapp'
import type { WhatsAppConnectionSession, WhatsAppManagementState } from '../../types/whatsapp'

export default function WhatsAppConnectionPanel({ state, onChanged }: { state: WhatsAppManagementState; onChanged: () => Promise<void> }) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const text = (key: string, values = {}) => t(`whatsappConnection.${key}`, values)
  const [channelId, setChannelId] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<WhatsAppConnectionSession | null>(null)
  const [status, setStatus] = useState('unknown')
  const [account, setAccount] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [qrExpiresAtMs, setQrExpiresAtMs] = useState(0)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const sessionRef = useRef<WhatsAppConnectionSession | null>(null)
  const qrExpiry = useRef(0)
  const errorText = (reason: unknown) => {
    const code = reason instanceof Error ? reason.message : 'connection-unavailable'
    return t(`whatsappConnection.errors.${code}`, { defaultValue: text('requestFailed') })
  }
  const cancel = (value: WhatsAppConnectionSession | null) => {
    if (value) void whatsappRequest('connection-cancel', { sessionId: value.id }).catch(() => {})
  }
  const close = () => {
    generation.current++
    controller.current?.abort()
    cancel(sessionRef.current)
    sessionRef.current = null
    setSession(null); setQr(null); setQrExpiresAtMs(0); qrExpiry.current = 0; setError('')
    setBusy(false)
  }
  useEffect(() => () => {
    generation.current++
    controller.current?.abort()
    cancel(sessionRef.current)
  }, [])
  useEffect(() => {
    if (!qrExpiresAtMs) return
    const timeout = setTimeout(() => setQr(null), Math.max(0, qrExpiresAtMs - Date.now()))
    return () => clearTimeout(timeout)
  }, [qrExpiresAtMs])

  const start = async (target: 'active' | 'candidate') => {
    const current = ++generation.current
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setError(''); setQr(null); qrExpiry.current = 0; setAccount(null)
    try {
      const result = await whatsappRequest<{ session: WhatsAppConnectionSession }>('connection-start', {
        target, ...(target === 'candidate' ? { candidateId: state.candidate?.id } : {}),
      }, abort.signal)
      if (current !== generation.current) return
      sessionRef.current = result.session
      setStatus('unknown'); setSession(result.session)
    } catch (reason) { if (current === generation.current) message.error(errorText(reason)) }
    finally { if (current === generation.current) setBusy(false) }
  }

  useEffect(() => {
    if (!session) return
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const current = generation.current
    const signal = controller.current?.signal
    const valid = () => !stopped && current === generation.current
    const poll = async () => {
      if (!valid()) return
      if (Date.now() >= session.expiresAtMs) { setStatus('expired'); setQr(null); return }
      if (document.visibilityState === 'visible') {
        try {
          const result = await whatsappRequest<{ status: string; account: string | null }>('connection-status', { sessionId: session.id }, signal)
          if (!valid()) return
          setStatus(result.status); setAccount(result.account); setError('')
          if (result.status === 'connected') {
            setQr(null); await onChanged(); return
          }
          if (['qr', 'connecting'].includes(result.status) && Date.now() >= qrExpiry.current) {
            setQr(null)
            const resultQr = await whatsappRequest<{ qr?: string; qrExpiresAtMs?: number }>('connection-qr', { sessionId: session.id }, signal)
            if (!valid()) return
            if (resultQr.qr && resultQr.qrExpiresAtMs) {
              setQr(resultQr.qr); qrExpiry.current = resultQr.qrExpiresAtMs; setQrExpiresAtMs(resultQr.qrExpiresAtMs)
            }
          } else if (!['qr', 'connecting'].includes(result.status)) setQr(null)
        } catch (reason) {
          if (!valid()) return
          setQr(null); qrExpiry.current = 0; setError(errorText(reason)); setStatus('unknown')
          if (reason instanceof Error && ['session-expired', 'candidate-expired', 'connection-changed', 'account-mismatch', 'channel-mismatch', 'credentials-invalid', 'qr-unsupported'].includes(reason.message)) return
        }
      } else setQr(null)
      if (valid()) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [session])

  const save = async (migrate: boolean) => {
    setBusy(true)
    try {
      await whatsappRequest(migrate ? 'candidate-migrate' : 'candidate-save', migrate ? {} : { channelId: channelId.trim(), token: token.trim() })
      setToken(''); await onChanged(); message.success(text('candidateSaved'))
    } catch (reason) { message.error(errorText(reason)) }
    finally { setToken(''); setBusy(false) }
  }
  const activate = () => {
    const candidate = state.candidate
    if (!candidate?.verified) return
    modal.confirm({ title: text('confirmSwitch'),
      content: text('switchSummary', { old: state.config.whapi.channelId || '-', next: candidate.channelId, account: candidate.account || '-' }),
      okText: text('activate'), cancelText: t('common.cancel'),
      onOk: async () => {
        setBusy(true)
        try {
          await whatsappRequest('candidate-activate', { candidateId: candidate.id, confirm: true })
          close(); await onChanged(); message.success(text('activated'))
        } catch (reason) { message.error(errorText(reason)); throw new Error('activation-failed') }
        finally { setBusy(false) }
      },
    })
  }

  return <section className="whatsapp-connection-panel" aria-label={text('title')}>
    <Typography.Title level={5}>{text('title')}</Typography.Title>
    <Space wrap>
      <Tag>{text(`source.${state.credentialSource || 'legacy-config'}`)}</Tag>
      <Tag color={state.whapiVerified ? 'green' : 'default'}>{text(`status.${state.connectionStatus || 'unknown'}`)}</Tag>
      <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void onChanged()}>{t('common.refresh')}</Button>
      <Button icon={<QrcodeOutlined />} disabled={busy || state.connectionBusy || !state.whapiCredentials || !state.config.whapi.channelId} onClick={() => void start('active')}>{text('connectActive')}</Button>
      {!state.managed && <Button icon={<SaveOutlined />} disabled={busy || !state.encryptionReady || !state.whapiCredentials || state.connectionBusy} onClick={() => void save(true)}>{text('migrate')}</Button>}
    </Space>
    {state.credentialsInvalid && <Alert type="error" showIcon message={text('invalidCredentials')} />}
    {!state.encryptionReady && <Alert type="warning" showIcon message={text('keyMissing')} />}
    {state.connectionBusy && <Alert type="info" showIcon message={text('connectionBusy')} />}
    <Typography.Title level={5}>{text('replacement')}</Typography.Title>
    <div className="whatsapp-settings-grid">
      <label>{text('channelId')}<Input value={channelId} maxLength={200} autoComplete="off" onChange={event => setChannelId(event.target.value)} disabled={busy || !state.encryptionReady} /></label>
      <label>{text('token')}<Input.Password value={token} maxLength={4096} autoComplete="new-password" visibilityToggle={false} onChange={event => setToken(event.target.value)} disabled={busy || !state.encryptionReady} /></label>
    </div>
    <Button icon={<SaveOutlined />} disabled={busy || !state.encryptionReady || !channelId.trim() || !token.trim() || state.connectionBusy} loading={busy} onClick={() => void save(false)}>{text('saveCandidate')}</Button>
    {state.candidate && <div className="whatsapp-candidate">
      <Typography.Text strong>{text('candidate')}: {state.candidate.channelId}</Typography.Text>
      <Tag color={state.candidate.verified ? 'green' : 'default'}>{text(state.candidate.verified ? 'verified' : 'unverified')}</Tag>
      {state.candidate.account && <Typography.Text>{state.candidate.account}</Typography.Text>}
      <Space wrap>
        <Button icon={<QrcodeOutlined />} disabled={busy || state.connectionBusy} onClick={() => void start('candidate')}>{text('connectCandidate')}</Button>
        <Button type="primary" icon={<LinkOutlined />} disabled={busy || !state.candidate.verified} onClick={activate}>{text('activate')}</Button>
      </Space>
    </div>}
    <Modal open={!!session} title={text('scanTitle')} onCancel={close} destroyOnHidden width={420}
      footer={<Space wrap><Button onClick={close}>{t('common.close')}</Button>
        {status !== 'connected' && <Button icon={<ReloadOutlined />} loading={busy} onClick={() => { if (session) void start(session.target) }}>{text('restart')}</Button>}
        {status === 'connected' && session?.target === 'candidate' && <Button type="primary" icon={<CheckCircleOutlined />} onClick={activate}>{text('activate')}</Button>}
      </Space>}>
      <Typography.Paragraph>{session?.channelId}</Typography.Paragraph>
      <Tag color={status === 'connected' ? 'green' : 'default'}>{text(`status.${status}`)}</Tag>
      {account && <Typography.Text>{account}</Typography.Text>}
      {error && <Alert type="error" showIcon message={error} />}
      <div className="whatsapp-qr-frame">
        {qr ? <img src={qr} alt={text('qrAlt')} onError={() => { setQr(null); setError(text('errors.provider-response-invalid')) }} /> : status === 'connected' ? <CheckCircleOutlined className="whatsapp-connected-icon" />
          : !error && !['expired', 'stopped', 'disconnected'].includes(status) ? <Spin /> : <QrcodeOutlined />}
      </div>
    </Modal>
  </section>
}
