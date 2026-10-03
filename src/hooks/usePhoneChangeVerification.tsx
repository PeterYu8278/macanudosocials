import { useEffect, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Space, message } from 'antd'
import { GoogleOutlined, LockOutlined } from '@ant-design/icons'
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth'
import { useTranslation } from 'react-i18next'
import { auth } from '../config/firebase'

export const usePhoneChangeVerification = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ password: string }>()
  const pending = useRef<((verified: boolean) => void) | null>(null)
  const finish = (verified: boolean) => {
    pending.current?.(verified)
    pending.current = null
    setOpen(false)
    form.resetFields()
  }
  useEffect(() => () => { pending.current?.(false); pending.current = null }, [])
  const verify = async (google: boolean) => {
    const current = auth.currentUser
    if (!current || busy) return
    try {
      const values = google ? null : await form.validateFields()
      setBusy(true)
      if (google) await reauthenticateWithPopup(current, new GoogleAuthProvider())
      else {
        if (!current.email) throw new Error('missing-email')
        await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, values!.password))
      }
      await current.getIdToken(true)
      finish(true)
    } catch (error) {
      if (!(error as { errorFields?: unknown })?.errorFields) message.error(t('profile.phoneSync.verificationFailed'))
    } finally { setBusy(false) }
  }
  const providers = auth.currentUser?.providerData.map(provider => provider.providerId) || []
  return {
    verifyPhoneChange: () => new Promise<boolean>(resolve => {
      if (pending.current) { resolve(false); return }
      pending.current = resolve
      form.resetFields()
      setOpen(true)
    }),
    phoneVerificationModal: (
      <Modal open={open} title={t('profile.phoneSync.verifyTitle')} zIndex={2200} centered width={420}
        footer={null} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={() => finish(false)}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {providers.includes('password') && (
            <Form form={form} layout="vertical" onFinish={() => { void verify(false) }}>
              <Form.Item name="password" label={t('profile.currentPassword')} rules={[{ required: true }]}>
                <Input.Password autoComplete="current-password" disabled={busy} />
              </Form.Item>
              <Button htmlType="submit" type="primary" icon={<LockOutlined />} loading={busy} block>{t('profile.phoneSync.verifyPassword')}</Button>
            </Form>
          )}
          {providers.includes('google.com') && <Button icon={<GoogleOutlined />} disabled={busy} block onClick={() => { void verify(true) }}>{t('profile.phoneSync.verifyGoogle')}</Button>}
          {!providers.some(provider => ['password', 'google.com'].includes(provider)) && <div>{t('profile.phoneSync.noProvider')}</div>}
        </Space>
      </Modal>
    ),
  }
}
