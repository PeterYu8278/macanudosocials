import { useEffect, useState } from 'react'
import { Alert, App, Button, Form, Grid, Input, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd'
import { CheckCircleOutlined, LinkOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/modules/auth'
import { whatsappRequest } from '../../services/api/whatsapp'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'
import { defaultWhatsAppSettings, type WhatsAppManagementState } from '../../types/whatsapp'
import './WhatsAppManagement.css'

const providers = ['manual', 'whapi', 'whatsmeow', 'waba'] as const
export default function WhatsAppManagement() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const user = useAuthStore(state => state.user)
  const manager = ['superAdmin', 'developer'].includes(user?.role || '')
  const screens = Grid.useBreakpoint()
  const [form] = Form.useForm()
  const [testForm] = Form.useForm()
  const [state, setState] = useState<WhatsAppManagementState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('channels')
  const [records, setRecords] = useState<any[]>([])
  const [lastStatus, setLastStatus] = useState('')
  const [testRequest, setTestRequest] = useState<{ fingerprint: string; id: string } | null>(null)
  const label = (key: string) => t(`whatsappManagement.${key}`)
  const showError = (reason: unknown) => {
    const code = reason instanceof Error ? reason.message : 'request-failed'
    message.error(t(`whatsappManagement.errors.${code}`, { defaultValue: label('requestFailed') }))
  }
  const apply = (value: WhatsAppManagementState) => { setState(value); form.setFieldsValue(value.config) }
  const load = async () => {
    setBusy(true)
    try { apply(await whatsappRequest('load')); setError('') }
    catch { setError(label('loadFailed')); setState(previous => previous || { config: defaultWhatsAppSettings, whapiCredentials: false, whapiVerified: false }) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  const save = async () => {
    setBusy(true)
    try { apply(await whatsappRequest('save', { config: await form.validateFields() })); message.success(t('common.saveSuccess')) }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  const health = async () => {
    setBusy(true)
    try { const result = await whatsappRequest<WhatsAppManagementState>('health'); setState(result); message.success(label('verified')) }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  const loadRecords = async () => {
    setBusy(true)
    try { const result = await whatsappRequest('records'); setRecords(result.records) }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  const send = async (action: 'manual' | 'test') => {
    let values
    try { values = await testForm.validateFields() } catch { return }
    const phone = normalizePhoneNumber(values.phone)
    if (!phone) { message.error(label('invalidPhone')); return }
    const fingerprint = JSON.stringify([action, phone, values.text])
    const requestId = testRequest?.fingerprint === fingerprint ? testRequest.id : crypto.randomUUID()
    setTestRequest({ fingerprint, id: requestId })
    // Open synchronously to preserve the browser's user gesture; navigate only after authorization.
    const popup = action === 'manual' ? window.open('about:blank', '_blank') : null
    if (action === 'manual' && !popup) { message.error(label('popupBlocked')); return }
    if (popup) popup.opener = null
    setBusy(true)
    try {
      const result = await whatsappRequest(action, { phone, text: values.text, requestId })
      setLastStatus(result.status)
      if (popup) popup.location.href = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(values.text)}`
    } catch (reason) { popup?.close(); showError(reason) } finally { setBusy(false) }
  }
  if (!state) return <div className="whatsapp-management"><Button loading>{t('common.loading')}</Button></div>
  const status = (provider: typeof providers[number]) => provider === 'manual' ? 'manualReady'
    : provider === 'whapi' ? state.whapiVerified ? 'verified' : state.whapiCredentials ? 'unverified' : 'notConfigured' : 'pendingIntegration'
  return <section className="whatsapp-management">
    {error && <Alert type="error" message={error} action={<Button icon={<ReloadOutlined />} loading={busy} onClick={load}>{t('common.retry')}</Button>} />}
    <Form form={form} initialValues={defaultWhatsAppSettings} layout="vertical" disabled={!manager || busy || !!error}>
      <div className="whatsapp-management-heading">
        <Typography.Title level={4}>{label('title')}</Typography.Title>
        <Form.Item name="enabled" valuePropName="checked" label={label('enabled')}><Switch /></Form.Item>
      </div>
      {!manager && <Alert type="info" message={label('readOnly')} />}
      <Tabs activeKey={tab} onChange={key => { setTab(key); if (key === 'records') void loadRecords() }} items={[
        { key: 'channels', label: label('channels') }, { key: 'rules', label: label('rules') },
        { key: 'testing', label: label('testing') }, { key: 'records', label: label('records') },
      ]} />
      <div hidden={tab !== 'channels'}>
        <Form.Item name="defaultProvider" label={label('defaultProvider')}><Select options={providers.map(provider => ({
          value: provider, label: label(provider), disabled: provider === 'waba' || provider === 'whatsmeow',
        }))} /></Form.Item>
        <div className="whatsapp-channel-list">
          {providers.map(provider => <div className="whatsapp-channel" key={provider}>
            <div className="whatsapp-channel-heading"><strong>{label(provider)}</strong><Tag color={provider === 'whapi' && state.whapiVerified ? 'green' : 'default'}>{label(status(provider))}</Tag></div>
            {provider === 'manual' && <Typography.Text type="secondary">{label('manualStatus')}</Typography.Text>}
            {provider === 'whapi' && <>
              <Form.Item name={['whapi', 'channelId']} label="Channel ID"><Input maxLength={200} /></Form.Item>
              <Space wrap><Tag>{label(state.whapiCredentials ? 'credentialsConfigured' : 'credentialsMissing')}</Tag>
                <Button icon={<CheckCircleOutlined />} onClick={health} disabled={!manager || busy || !state.whapiCredentials}>{label('verifyConnection')}</Button></Space>
            </>}
            {provider === 'whatsmeow' && <div className="whatsapp-settings-grid">
              <Form.Item name={['whatsmeow', 'baseUrl']} label={label('gatewayUrl')} rules={[{ type: 'url' }]}><Input placeholder="https://" maxLength={500} /></Form.Item>
              <Form.Item name={['whatsmeow', 'phone']} label={label('phone')}><Input maxLength={30} /></Form.Item>
            </div>}
            {provider === 'waba' && <div className="whatsapp-settings-grid">
              <Form.Item name={['waba', 'wabaId']} label="WABA ID"><Input maxLength={200} /></Form.Item>
              <Form.Item name={['waba', 'phoneNumberId']} label="Phone Number ID"><Input maxLength={200} /></Form.Item>
              <Form.Item name={['waba', 'phone']} label={label('phone')}><Input maxLength={30} /></Form.Item>
            </div>}
          </div>)}
        </div>
      </div>
      <div hidden={tab !== 'rules'}>
        {(['eventReminder', 'vipExpiry', 'passwordReset'] as const).map(feature => <div className="whatsapp-rule" key={feature}>
          <span>{label(feature)}</span><Form.Item name={['features', feature]} valuePropName="checked" noStyle><Switch /></Form.Item>
        </div>)}
        <Alert type="info" message={label('consentNote')} />
      </div>
      <div hidden={tab !== 'testing'}>
        <Form.Item name="testPhones" label={label('testPhones')}><Select mode="tags" tokenSeparators={[',', ';']} maxCount={20} /></Form.Item>
      </div>
      {tab !== 'records' && <div className="whatsapp-save"><Button icon={<SaveOutlined />} type="primary" onClick={save} loading={busy} disabled={!manager || !!error}>{t('common.save')}</Button></div>}
    </Form>
    {tab === 'testing' && <Form form={testForm} layout="vertical" onValuesChange={() => { setTestRequest(null); setLastStatus('') }}>
      <div className="whatsapp-settings-grid">
        <Form.Item name="phone" label={label('phone')} rules={[{ required: true }]}><Input inputMode="tel" maxLength={30} /></Form.Item>
        <Form.Item name="text" label={label('message')} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
      </div>
      <Space wrap>
        <Button icon={<LinkOutlined />} disabled={busy || !state.config.enabled} onClick={() => send('manual')}>{label('openWhatsApp')}</Button>
        <Button icon={<SendOutlined />} disabled={busy || !manager || !state.whapiVerified} onClick={() => send('test')}>{label('sendTest')}</Button>
      </Space>
      {lastStatus && <Alert className="whatsapp-result" type={lastStatus === 'failed' || lastStatus === 'unknown' || lastStatus === 'submitting' ? 'warning' : 'info'} message={label(`status.${lastStatus}`)} />}
    </Form>}
    {tab === 'records' && <>
      <Button icon={<ReloadOutlined />} onClick={loadRecords} loading={busy}>{t('common.refresh')}</Button>
      <Table size="small" rowKey="id" dataSource={records} loading={busy} scroll={{ x: 580 }} pagination={{ pageSize: screens.md ? 10 : 5 }} columns={[
        { title: label('time'), dataIndex: 'createdAt', render: value => value ? new Date(value).toLocaleString() : '-' },
        { title: label('channels'), dataIndex: 'provider', render: value => label(value) },
        { title: label('phone'), dataIndex: 'phone' },
        { title: label('statusLabel'), dataIndex: 'status', render: value => <Tag>{label(`status.${value}`)}</Tag> },
        { title: label('testing'), dataIndex: 'test', render: value => value ? label('test') : label('business') },
      ]} />
    </>}
  </section>
}
