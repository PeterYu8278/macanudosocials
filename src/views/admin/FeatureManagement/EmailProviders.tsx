import { useEffect, useState } from 'react'
import { App, Button, Form, Select, Space, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { AppConfig } from '../../../types'
import { updateAppConfig } from '../../../services/firebase/appConfig'

export default function EmailProviders({ config, userId, onSaved }: {
  config: AppConfig | null; userId?: string; onSaved: () => void
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    form.setFieldsValue({ passwordReset: config?.emailProviders?.passwordReset || 'firebase', emailChange: 'resend' })
  }, [config, form])
  return <section style={{ maxWidth: 680, paddingTop: 16 }}>
    <Typography.Title level={4}>{t('communications.emailProviders')}</Typography.Title>
    <Form form={form} layout="vertical" onFinish={async values => {
      if (!userId) return
      setSaving(true)
      try {
        const result = await updateAppConfig({ emailProviders: { passwordReset: values.passwordReset, emailChange: 'resend' } }, userId)
        if (!result.success) throw new Error(result.error)
        message.success(t('communications.saved'))
        onSaved()
      } catch { message.error(t('communications.saveFailed')) }
      finally { setSaving(false) }
    }}>
      <Form.Item name="passwordReset" label={t('communications.passwordReset')} rules={[{ required: true }]}>
        <Select options={[{ value: 'firebase', label: 'Firebase Authentication' }, { value: 'resend', label: 'Resend' }]} />
      </Form.Item>
      <Form.Item name="emailChange" label={t('communications.emailChange')} extra={t('communications.emailChangeConstraint')}>
        <Select options={[{ value: 'resend', label: 'Resend' }, { value: 'firebase', label: 'Firebase Authentication', disabled: true }]} />
      </Form.Item>
      <Space wrap>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} disabled={!userId || !config} style={{ background: 'linear-gradient(to right, #FDE08D, #C48D3A)', border: 'none', color: '#111' }}>{t('common.save')}</Button>
        <Button href="https://resend.com" target="_blank" rel="noopener noreferrer">Resend</Button>
        <Button href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase Console</Button>
      </Space>
    </Form>
  </section>
}
