import { Button, Form, Input, Typography } from 'antd'
import { GiftOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { isValidEmail, normalizePhoneNumber } from '../../utils/phoneNormalization'
import { getUserByMemberId } from '../../utils/memberId'

type RegisterFormProps = {
  form: ReturnType<typeof Form.useForm>[0]
  loading?: boolean
  onFinish: (values: any) => void | Promise<unknown>
  onSwitchToLogin?: () => void
  compact?: boolean
}

const inputStyle = {
  background: 'rgba(45, 45, 45, 0.8)',
  border: '1px solid #444444',
  borderRadius: '8px',
  color: '#f8f8f8'
}

export default function RegisterForm({ form, loading = false, onFinish, onSwitchToLogin, compact = false }: RegisterFormProps) {
  const { t } = useTranslation()
  const itemStyle = { marginBottom: compact ? '8px' : '4px' }

  return <>
    <Form
      className="auth-form"
      form={form}
      name="register"
      onFinish={onFinish}
      layout="vertical"
      size="large"
      autoComplete="off"
      style={{ padding: compact ? '0 24px' : '0 12px' }}
    >
      <Form.Item name="displayName" rules={[{ required: true, message: t('auth.nameRequired') }]} style={itemStyle}>
        <Input prefix={<UserOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.name')} style={inputStyle} />
      </Form.Item>
      <Form.Item
        name="phone"
        rules={[
          { required: true, message: t('auth.phoneRequired') },
          { pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/, message: t('profile.phoneInvalidLength') },
          { validator: async (_, value) => {
            if (!value || !/^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/.test(value)) return
            const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
            const { db } = await import('../../config/firebase')
            const normalized = normalizePhoneNumber(value)
            if (!normalized) return
            try {
              const snapshot = await getDocs(query(collection(db, 'users'), where('profile.phone', '==', normalized), limit(1)))
              if (!snapshot.empty) throw new Error(t('profile.phoneUsed'))
            } catch (error) {
              if (error instanceof Error && error.message === t('profile.phoneUsed')) throw error
            }
          } }
        ]}
        getValueFromEvent={(event) => event.target.value.replace(/[^\d+]/g, '')}
        validateTrigger={['onBlur']}
        style={itemStyle}
      >
        <Input prefix={<UserOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.phone')} style={inputStyle} />
      </Form.Item>
      <Form.Item
        name="email"
        rules={[
          { required: true, type: 'email', message: t('auth.emailRequired') },
          { validator: async (_, value) => {
            if (!value || !isValidEmail(value)) return
            const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
            const { db } = await import('../../config/firebase')
            try {
              const snapshot = await getDocs(query(collection(db, 'users'), where('email', '==', value.toLowerCase().trim()), limit(1)))
              if (!snapshot.empty) throw new Error(t('profile.emailUsed'))
            } catch (error) {
              if (error instanceof Error && error.message === t('profile.emailUsed')) throw error
            }
          } }
        ]}
        validateTrigger={['onBlur']}
        style={itemStyle}
      >
        <Input prefix={<MailOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.email')} style={inputStyle} />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, message: t('auth.passwordRequired') }, { min: 6, message: t('auth.passwordMinLength') }]} style={itemStyle}>
        <Input.Password prefix={<LockOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.password')} style={inputStyle} />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        dependencies={['password']}
        rules={[{ required: true, message: t('auth.confirmPasswordRequired') }, ({ getFieldValue }) => ({ validator(_, value) {
          return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error(t('auth.passwordsDoNotMatch')))
        } })]}
        style={itemStyle}
      >
        <Input.Password prefix={<LockOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.confirmPassword')} style={inputStyle} />
      </Form.Item>
      <Form.Item
        name="referralCode"
        style={itemStyle}
        rules={[{
          validator: async (_, value) => {
            if (!value || value.trim() === '') return Promise.resolve()
            try {
              const result = await getUserByMemberId(value.trim().toUpperCase())
              return result.success
                ? Promise.resolve()
                : Promise.reject(new Error(result.error || t('auth.referralCodeNotFound')))
            } catch {
              return Promise.reject(new Error(t('auth.referralCodeVerifyFailed')))
            }
          }
        }]}
        validateTrigger={['onBlur', 'onChange']}
        validateDebounce={500}
      >
        <Input prefix={<GiftOutlined style={{ color: '#ffd700' }} />} placeholder={t('auth.referralCodePlaceholder')} onInput={event => { event.currentTarget.value = event.currentTarget.value.toUpperCase() }} style={inputStyle} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={loading} style={{ width: '100%', height: compact ? '44px' : '44px', background: 'linear-gradient(to right,#FDE08D,#C48D3A)', border: 'none', borderRadius: '8px', color: '#221c10', fontSize: '16px', fontWeight: 600, marginTop: compact ? '6px' : 0, boxShadow: '0 4px 20px rgba(255, 215, 0, 0.3)' }}>
        {t('auth.register')}
      </Button>
    </Form>
    {onSwitchToLogin && <div style={{ textAlign: 'center', marginTop: compact ? '12px' : '10px' }}>
      <Typography.Text style={{ color: '#999999', fontSize: '14px' }}>
        {t('auth.alreadyHaveAccount')} {' '}
        <a onClick={onSwitchToLogin} style={{ color: '#d6a84a', fontWeight: 700, cursor: 'pointer' }}>{t('auth.signIn')}</a>
      </Typography.Text>
    </div>}
  </>
}
