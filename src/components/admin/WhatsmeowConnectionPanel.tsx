import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Modal, QRCode, Select, Space, Tag, Typography } from 'antd'
import { CheckOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { whatsappRequest } from '../../services/api/whatsapp'

interface Status { status: string; account: string; qr: string; qrExpiresAtMs: number }
export default function WhatsmeowConnectionPanel({ gateways, onChanged }: { gateways: string[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const label = (key: string) => t(`whatsmeowConnection.${key}`)
  const [gatewayId, setGatewayId] = useState<string>()
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [staged, setStaged] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0)
  const expires = useRef(0)
  const polling = useRef(false)
  useEffect(() => () => { generation.current++ }, [])
  const run = async (action: string, data = {}) => {
    const current = generation.current
    setBusy(true)
    try {
      const result = await whatsappRequest(action, data)
      if (current !== generation.current) return
      if (action === 'meow-stage') { setStaged(true); setToken(''); setStatus(null); expires.current = Date.now() + 9 * 60000 }
      if (action === 'meow-status') setStatus(result)
      if (action === 'meow-activate') { setOpen(false); setStaged(false); setStatus(null); await onChanged() }
    } catch (error) {
      if (current === generation.current) message.error(t(`whatsappManagement.errors.${error instanceof Error ? error.message : ''}`, { defaultValue: label('failed') }))
    } finally { if (current === generation.current) setBusy(false) }
  }
  useEffect(() => {
    if (!open || !staged) return
    let disposed = false
    const controller = new AbortController()
    const poll = setInterval(() => {
      setNow(Date.now())
      if (expires.current <= Date.now()) { setStaged(false); setStatus(null); return }
      if (document.visibilityState !== 'visible') { setStatus(null); return }
      if (polling.current) return
      polling.current = true
      void whatsappRequest<Status>('meow-status', {}, controller.signal).then(value => { if (!disposed) setStatus(value) }).catch(() => { if (!disposed) setStatus(null) }).finally(() => { polling.current = false })
    }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { disposed = true; clearInterval(poll); clearInterval(clock); controller.abort() }
  }, [open, staged])
  return <section className="whatsapp-channel">
    <Typography.Title level={5}>{label('title')}</Typography.Title>
    {!gateways.length && <Alert type="info" message={label('notRegistered')} />}
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select style={{ width: '100%' }} aria-label={label('gateway')} placeholder={label('gateway')} value={gatewayId} disabled={busy || staged}
        options={gateways.map(value => ({ value, label: value }))} onChange={value => { setGatewayId(value); setStaged(false); setStatus(null) }} />
      <Input.Password aria-label={label('token')} placeholder={label('token')} value={token} autoComplete="off" maxLength={2000} disabled={busy || staged} onChange={event => setToken(event.target.value)} />
      <Button icon={<LinkOutlined />} loading={busy} disabled={!gatewayId || token.trim().length < 32 || staged} onClick={() => void run('meow-stage', { gatewayId, token })}>{label('stage')}</Button>
      {staged && <Button icon={<ReloadOutlined />} onClick={() => setOpen(true)}>{label('open')}</Button>}
    </Space>
    <Modal title={label('title')} open={open} footer={null} onCancel={() => { generation.current++; setBusy(false); setOpen(false); setStatus(null) }} destroyOnHidden>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Tag>{status?.status || label('waiting')}</Tag>
        {status?.qr && status.qrExpiresAtMs > now && <QRCode value={status.qr} size={240} style={{ maxWidth: '100%', background: 'white', margin: 'auto' }} />}
        {status?.account && <Typography.Text>{label('account')}: {status.account}</Typography.Text>}
        <Button icon={<LinkOutlined />} loading={busy} onClick={() => void run('meow-pair')}>{label('pair')}</Button>
        <Input aria-label={label('confirmAccount')} placeholder={label('confirmAccount')} value={account} maxLength={16} onChange={event => setAccount(event.target.value)} />
        <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={status?.status !== 'connected' || !/^\+[1-9]\d{6,14}$/.test(account)}
          onClick={() => Modal.confirm({ title: label('activateTitle'), content: label('activateWarning'), onOk: () => run('meow-activate', { account, confirm: true }) })}>{label('activate')}</Button>
      </Space>
    </Modal>
  </section>
}
