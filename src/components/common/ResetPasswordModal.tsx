import React, { useEffect, useState } from 'react'
import { App, Button, Form, Input, Modal, Space } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { resetPasswordByPhone, sendPasswordResetEmailFor } from '../../services/firebase/auth'
import type { AppConfig } from '../../types'
import { identifyInputType, isValidEmail, normalizePhoneNumber } from '../../utils/phoneNormalization'

interface ResetPasswordModalProps {
  open: boolean
  onClose: () => void
  appConfig: AppConfig | null
}

const RESET_COOLDOWN_MS = 60_000
const RESET_STORAGE_KEY = 'resetPasswordLastSendTime'

const getLastSendTime = (): number | null => {
  try {
    const stored = localStorage.getItem(RESET_STORAGE_KEY)
    if (!stored) return null

    const timestamp = Number.parseInt(stored, 10)
    if (!Number.isFinite(timestamp) || Date.now() - timestamp >= RESET_COOLDOWN_MS) {
      localStorage.removeItem(RESET_STORAGE_KEY)
      return null
    }
    return timestamp
  } catch {
    return null
  }
}

const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ open, onClose, appConfig }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<{ identifier: string }>()
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState<number | null>(null)
  const phoneOnly = Boolean(appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin)

  useEffect(() => {
    if (!open) return

    const updateCooldown = () => {
      const lastSendTime = getLastSendTime()
      if (lastSendTime === null) {
        setCooldown(null)
        return
      }
      setCooldown(Math.max(1, Math.ceil((RESET_COOLDOWN_MS - (Date.now() - lastSendTime)) / 1000)))
    }

    updateCooldown()
    const interval = window.setInterval(updateCooldown, 1000)
    return () => window.clearInterval(interval)
  }, [open])

  const closeModal = () => {
    form.resetFields()
    onClose()
  }

  const handleSubmit = async ({ identifier: rawIdentifier }: { identifier: string }) => {
    if (getLastSendTime() !== null) return

    setLoading(true)
    try {
      const identifier = rawIdentifier.trim()
      const inputType = phoneOnly ? 'phone' : identifyInputType(identifier)

      if (inputType === 'email') {
        const result = await sendPasswordResetEmailFor(identifier)
        if (!result.success) {
          message.error(result.error?.message || t('auth.sendResetEmailFailed'))
          return
        }
        message.success(t('auth.resetEmailSent'))
      } else if (inputType === 'phone') {
        const result = await resetPasswordByPhone(identifier)
        if (!result.success) {
          message.error(result.error || t('auth.resetPasswordFailed'))
          return
        }
        message.success(t('auth.passwordResetSentToPhone'))
      } else {
        message.error(t('auth.invalidEmailOrPhone'))
        return
      }

      localStorage.setItem(RESET_STORAGE_KEY, Date.now().toString())
      closeModal()
    } catch (error: any) {
      message.error(error?.message || t('auth.resetPasswordFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={(
        <span style={{ color: '#FDE08D', fontWeight: 700 }}>
          {t('auth.resetPassword')}
        </span>
      )}
      open={open}
      onCancel={closeModal}
      footer={null}
      width={372}
      centered
      destroyOnHidden
      styles={{
        content: {
          background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.98), rgba(45, 45, 45, 0.96))',
          border: '1px solid rgba(197, 165, 90, 0.4)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)'
        },
        header: {
          background: 'transparent',
          borderBottom: '1px solid rgba(255, 215, 0, 0.16)',
          paddingBottom: 14
        }
      }}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 24 }}>
        {cooldown !== null && cooldown > 0 && (
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid rgba(255, 193, 7, 0.3)',
            borderRadius: 8,
            color: '#FDE08D',
            fontSize: 13,
            textAlign: 'center'
          }}>
            {t('auth.cooldownMessage', { seconds: cooldown })}
          </div>
        )}

        <Form.Item
          name="identifier"
          label={<span style={{ color: '#c0c0c0' }}>{phoneOnly ? t('auth.phone') : t('auth.emailOrPhoneLabel')}</span>}
          rules={[
            { required: true, message: phoneOnly ? t('auth.phoneOnlyRequired') : t('auth.pleaseEnterEmailOrPhone') },
            {
              validator: (_, value?: string) => {
                if (!value) return Promise.resolve()
                if (phoneOnly) {
                  return normalizePhoneNumber(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('profile.phoneInvalidFormat')))
                }

                const type = identifyInputType(value)
                if (type === 'email' && isValidEmail(value)) return Promise.resolve()
                if (type === 'phone' && normalizePhoneNumber(value)) return Promise.resolve()
                return Promise.reject(new Error(t('auth.invalidEmailOrPhone')))
              }
            }
          ]}
        >
          <Input
            prefix={<UserOutlined style={{ color: '#FFD700' }} />}
            placeholder={phoneOnly ? t('auth.phone') : t('auth.emailOrPhonePlaceholder')}
            inputMode={phoneOnly ? 'numeric' : 'email'}
            autoComplete="username"
            style={{
              height: 46,
              background: 'rgba(45, 45, 45, 0.8)',
              border: '1px solid #4a463d',
              borderRadius: 8,
              color: '#f8f8f8'
            }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button htmlType="button" onClick={closeModal} style={{ color: '#c0c0c0', borderColor: '#4a463d' }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={cooldown !== null && cooldown > 0}
              style={{
                background: cooldown ? 'rgba(255, 255, 255, 0.1)' : 'linear-gradient(to right,#FDE08D,#C48D3A)',
                border: 'none',
                color: cooldown ? '#999' : '#221c10',
                fontWeight: 700
              }}
            >
              {cooldown ? t('auth.waitSecondsButton', { seconds: cooldown }) : t('auth.sendReset')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ResetPasswordModal
