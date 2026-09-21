// User Profile Page
import React, { useState, useEffect } from 'react'
import {
  Button, Modal, Form, Input, message, Switch, Select, Space,
  Typography, Checkbox, Divider, TimePicker, Drawer, Tabs
} from 'antd'
import {
  ArrowLeftOutlined, MailOutlined, PhoneOutlined, BellOutlined,
  CalendarOutlined, WalletOutlined, ShoppingOutlined, GiftOutlined,
  SaveOutlined, LockOutlined, SettingOutlined, UserOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'

import { useAuthStore } from '../../../store/modules/auth'
import { useTranslation } from 'react-i18next'
import { ProfileView } from '../../../components/common/ProfileView'
import ImageUpload from '../../../components/common/ImageUpload'
import { updateDocument, getUserById } from '../../../services/firebase/firestore'
import { normalizePhoneNumber } from '../../../utils/phoneNormalization'
import type { User } from '../../../types'
import { auth } from '../../../config/firebase'
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { getResponsiveModalConfig, getModalTheme } from '../../../config/modalTheme'
import LanguageSelect from '../../../components/common/LanguageSelect'

const Profile: React.FC = () => {
  const { user, setUser } = useAuthStore()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission
    }
    return 'default'
  })
  const [form] = Form.useForm()
  const [activeTab, setActiveTab] = useState('basic')

  // Reactive isMobile — fixed from exact-width bug
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const theme = getModalTheme()
  const labelFlex = isMobile ? '40%' : '120px'

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission)
    }
  }, [])

  const buildFormValues = (userData: User) => {
    const pushPrefs = (userData as any)?.preferences?.pushNotifications || {}
    const quietHours = pushPrefs.quietHours || {}
    return {
      displayName: userData.displayName || '',
      email: userData.email || '',
      phone: (userData as any)?.profile?.phone || '',
      notifications: (userData as any)?.preferences?.notifications ?? true,
      language: (() => {
        const raw = (userData as any)?.preferences?.locale || i18n.language || 'zh-CN'
        if (raw === 'zh' || raw.startsWith('zh')) return 'zh-CN'
        if (raw === 'en' || raw.startsWith('en')) return 'en-US'
        return raw
      })(),
      pushActivity: pushPrefs.types?.activity ?? true,
      pushPoints: pushPrefs.types?.points ?? true,
      pushOrder: pushPrefs.types?.order ?? true,
      pushMarketing: pushPrefs.types?.marketing ?? true,
      quietHoursEnabled: quietHours.enabled ?? false,
      quietHoursStart: quietHours.start ? dayjs(quietHours.start, 'HH:mm') : dayjs('22:00', 'HH:mm'),
      quietHoursEnd: quietHours.end ? dayjs(quietHours.end, 'HH:mm') : dayjs('09:00', 'HH:mm'),
    }
  }

  const handleEdit = async (userToEdit?: User) => {
    const u = userToEdit || user
    if (!u) return
    setEditing(true)
    setActiveTab('basic')
    try {
      const latestUser = await getUserById(u.id)
      const userData = latestUser || u
      setTimeout(() => { form.setFieldsValue(buildFormValues(userData)) }, 0)
    } catch {
      setTimeout(() => { form.setFieldsValue(buildFormValues(u)) }, 0)
    }
  }

  const handleSave = async () => {
    if (!user) return
    try {
      const values = await form.validateFields()
      setSaving(true)

      const updates: any = {
        displayName: values.displayName,
        'profile.phone': normalizePhoneNumber(values.phone),
        'preferences.notifications': values.notifications,
        ...(values.language ? { 'preferences.locale': values.language } : {}),
        'preferences.pushNotifications.types.activity': values.pushActivity === true,
        'preferences.pushNotifications.types.points': values.pushPoints === true,
        'preferences.pushNotifications.types.order': values.pushOrder === true,
        'preferences.pushNotifications.types.marketing': values.pushMarketing === true,
        'preferences.pushNotifications.quietHours.enabled': values.quietHoursEnabled === true,
        updatedAt: new Date(),
      }
      if (values.quietHoursStart) {
        updates['preferences.pushNotifications.quietHours.start'] = values.quietHoursStart.format('HH:mm')
      }
      if (values.quietHoursEnd) {
        updates['preferences.pushNotifications.quietHours.end'] = values.quietHoursEnd.format('HH:mm')
      }

      const updateResult = await updateDocument('users', user.id, updates)
      if (!updateResult.success) throw new Error('Update failed')

      const currentUser = auth.currentUser

      if (values.email && values.email !== user.email) {
        if (!currentUser) throw new Error('not logged in')
        if (values.currentPassword) {
          const credential = EmailAuthProvider.credential(user.email || '', values.currentPassword)
          await reauthenticateWithCredential(currentUser, credential)
          await updateEmail(currentUser, values.email)
          updates.email = values.email
        } else {
          message.warning(t('profile.emailChangeRequiresPassword'))
        }
      }

      if (values.newPassword) {
        if (!currentUser) throw new Error('not logged in')
        if (values.currentPassword) {
          const credential = EmailAuthProvider.credential(user.email || '', values.currentPassword)
          await reauthenticateWithCredential(currentUser, credential)
          await updatePassword(currentUser, values.newPassword)
          message.success(t('profile.passwordUpdated'))
        } else {
          message.warning(t('profile.passwordChangeRequiresCurrentPassword'))
        }
      }

      try {
        const latestUser = await getUserById(user.id)
        if (latestUser) {
          setUser(latestUser as any)
        } else {
          setUser({ ...user, displayName: values.displayName, email: updates.email || user.email, profile: { ...(user as any)?.profile, phone: normalizePhoneNumber(values.phone) }, preferences: { ...(user as any)?.preferences, notifications: values.notifications, locale: values.language || (user as any)?.preferences?.locale, pushNotifications: { types: { activity: values.pushActivity, points: values.pushPoints, order: values.pushOrder, marketing: values.pushMarketing }, quietHours: { enabled: values.quietHoursEnabled, start: values.quietHoursStart ? values.quietHoursStart.format('HH:mm') : undefined, end: values.quietHoursEnd ? values.quietHoursEnd.format('HH:mm') : undefined } } } } as any)
        }
      } catch {
        setUser({ ...user, displayName: values.displayName, email: updates.email || user.email, profile: { ...(user as any)?.profile, phone: normalizePhoneNumber(values.phone) }, preferences: { ...(user as any)?.preferences, notifications: values.notifications, locale: values.language || (user as any)?.preferences?.locale, pushNotifications: { types: { activity: values.pushActivity, points: values.pushPoints, order: values.pushOrder, marketing: values.pushMarketing }, quietHours: { enabled: values.quietHoursEnabled, start: values.quietHoursStart ? values.quietHoursStart.format('HH:mm') : undefined, end: values.quietHoursEnd ? values.quietHoursEnd.format('HH:mm') : undefined } } } } as any)
      }

      if (values.language && values.language !== i18n.language) {
        try { await i18n.changeLanguage(values.language) } catch {}
      }

      message.success(t('profile.saveSuccess'))
      setEditing(false)
    } catch (err: any) {
      if (err?.code === 'auth/wrong-password') {
        message.error(t('profile.incorrectPassword'))
      } else if (err?.code === 'auth/weak-password') {
        message.error(t('profile.weakPassword'))
      } else if (err?.errorFields) {
        // Form validation error — do nothing, errors are shown inline
      } else {
        message.error(t('profile.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Shared form sections ────────────────────────────────────────────────────

  const renderBasicSection = () => (
    <Form
      form={form}
      layout={isMobile ? 'vertical' : 'horizontal'}
      labelCol={isMobile ? undefined : { flex: labelFlex }}
      wrapperCol={isMobile ? undefined : { flex: '1 0 0' }}
      labelAlign="left"
      labelWrap={false}
      style={{ rowGap: isMobile ? 0 : 8 }}
    >
      <Form.Item label={<span style={{ color: '#fff' }}>{t('profile.avatar')}</span>} style={{ marginBottom: 8 }}>
        <ImageUpload
          value={(user as any)?.profile?.avatar}
          onChange={async (url) => {
            if (!user) return
            try {
              await updateDocument('users', user.id, { 'profile.avatar': url, updatedAt: new Date() })
              setUser({ ...user, profile: { ...(user as any)?.profile, avatar: url } } as any)
              message.success(t('profile.avatarUpdated'))
            } catch {
              message.error(t('profile.saveFailed'))
            }
          }}
          folder="avatars"
        />
      </Form.Item>

      <Form.Item
        name="displayName"
        label={<span style={{ color: '#fff' }}>{t('profile.nameLabel')}</span>}
        rules={[{ required: true, message: t('profile.nameRequired') }]}
        style={{ marginBottom: 8 }}
      >
        <Input placeholder={t('profile.namePlaceholder')} />
      </Form.Item>

      <Form.Item
        name="email"
        label={<span style={{ color: '#fff' }}>{t('auth.email')}</span>}
        rules={[
          { required: true, message: t('auth.emailRequired') },
          { type: 'email', message: t('auth.emailInvalid') },
          {
            validator: async (_, value) => {
              if (!!(user as any)?.providerData?.find((p: any) => p.providerId === 'google.com')) return Promise.resolve()
              if (!value || value === user?.email) return Promise.resolve()
              const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
              if (!emailPattern.test(value)) return Promise.resolve()
              const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
              const { db } = await import('../../../config/firebase')
              try {
                const snap = await getDocs(query(collection(db, 'users'), where('email', '==', value.toLowerCase().trim()), limit(1)))
                if (!snap.empty) return Promise.reject(new Error(t('profile.emailUsed')))
              } catch {}
              return Promise.resolve()
            }
          }
        ]}
        validateTrigger={['onBlur', 'onChange']}
        validateDebounce={500}
        style={{ marginBottom: 8 }}
      >
        <Input
          prefix={<MailOutlined />}
          type="email"
          disabled={!!(user as any)?.providerData?.find((p: any) => p.providerId === 'google.com')}
          placeholder={t('auth.emailPlaceholder')}
        />
      </Form.Item>

      <Form.Item
        name="phone"
        label={<span style={{ color: '#fff' }}>{t('profile.phoneLabel')}</span>}
        rules={[
          { required: true, message: t('profile.phoneRequired') },
          { pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/, message: t('profile.phoneInvalidLength') },
          {
            validator: async (_, value) => {
              if (!value) return Promise.resolve()
              const currentPhone = normalizePhoneNumber((user as any)?.profile?.phone || '')
              const newPhone = normalizePhoneNumber(value)
              if (newPhone === currentPhone) return Promise.resolve()
              const formatPattern = /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/
              if (!formatPattern.test(value)) return Promise.resolve()
              const normalized = normalizePhoneNumber(value)
              if (!normalized) return Promise.resolve()
              try {
                const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
                const { db } = await import('../../../config/firebase')
                const snap = await getDocs(query(collection(db, 'users'), where('profile.phone', '==', normalized), limit(1)))
                if (!snap.empty && snap.docs[0].id !== user?.id) return Promise.reject(new Error(t('profile.phoneUsed')))
              } catch {}
              return Promise.resolve()
            }
          }
        ]}
        validateTrigger={['onBlur', 'onChange']}
        validateDebounce={500}
        style={{ marginBottom: 0 }}
      >
        <Input
          prefix={<PhoneOutlined />}
          placeholder={t('profile.phonePlaceholder')}
          onInput={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/[^\d+\s-]/g, '') }}
        />
      </Form.Item>
    </Form>
  )

  const renderSecuritySection = () => (
    <Form
      form={form}
      layout={isMobile ? 'vertical' : 'horizontal'}
      labelCol={isMobile ? undefined : { flex: labelFlex }}
      wrapperCol={isMobile ? undefined : { flex: '1 0 0' }}
      labelAlign="left"
      labelWrap={false}
      style={{ rowGap: isMobile ? 0 : 8 }}
    >
      <Form.Item
        name="currentPassword"
        label={<span style={{ color: '#fff' }}>{t('profile.currentPassword')}</span>}
        style={{ marginBottom: 8 }}
      >
        <Input.Password placeholder={t('profile.currentPasswordPlaceholder')} />
      </Form.Item>

      <Form.Item
        name="newPassword"
        label={<span style={{ color: '#fff' }}>{t('profile.newPassword')}</span>}
        rules={[{ min: 6, message: t('profile.passwordMinLength') }]}
        style={{ marginBottom: 8 }}
      >
        <Input.Password placeholder={t('profile.newPasswordPlaceholder')} />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label={<span style={{ color: '#fff' }}>{t('profile.confirmPassword')}</span>}
        dependencies={['newPassword']}
        rules={[
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
              return Promise.reject(new Error(t('profile.passwordMismatch')))
            }
          })
        ]}
        style={{ marginBottom: 0 }}
      >
        <Input.Password placeholder={t('profile.confirmPasswordPlaceholder')} />
      </Form.Item>
    </Form>
  )

  const renderPreferencesSection = () => (
    <>
      <Form
        form={form}
        layout={isMobile ? 'vertical' : 'horizontal'}
        labelCol={isMobile ? undefined : { flex: labelFlex }}
        wrapperCol={isMobile ? undefined : { flex: '1 0 0' }}
        labelAlign="left"
        labelWrap={false}
      >
        <Form.Item
          name="notifications"
          valuePropName="checked"
          style={{ marginBottom: 12 }}
          label={<span style={{ color: '#fff' }}>{t('profile.notificationsToggle')}</span>}
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="language"
          label={<span style={{ color: '#fff' }}>{t('profile.language')}</span>}
          style={{ marginBottom: 0 }}
        >
          <LanguageSelect />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '16px 0', borderColor: 'rgba(255,255,255,0.1)' }} />

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BellOutlined style={{ marginRight: 8, color: '#F4AF25' }} />
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
          {t('profile.pushNotifications.title')}
        </span>
      </div>

      {notificationPermission !== 'granted' && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'rgba(244,175,37,0.1)',
          border: '1px solid rgba(244,175,37,0.6)',
          marginBottom: 12
        }}>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
            {notificationPermission === 'denied'
              ? t('profile.pushNotifications.permissionDeniedHint')
              : t('profile.pushNotifications.permissionRequiredHint')}
          </Typography.Text>
        </div>
      )}

      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item
          noStyle
          shouldUpdate={(prev, cur) => prev.notifications !== cur.notifications}
        >
          {({ getFieldValue }) => {
            const notificationsEnabled = getFieldValue('notifications') && notificationPermission === 'granted'
            return (
              <>
                <div style={{
                  padding: 12, borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  marginBottom: 12,
                  opacity: notificationsEnabled ? 1 : 0.5,
                  pointerEvents: notificationsEnabled ? 'auto' : 'none'
                }}>
                  <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                    {t('profile.pushNotifications.notificationTypes')}
                  </Typography.Text>
                  <Form.Item name="pushActivity" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox><CalendarOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.activity')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushPoints" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox><WalletOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.points')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushOrder" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox><ShoppingOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.order')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushMarketing" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Checkbox><GiftOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.marketing')}</Checkbox>
                  </Form.Item>
                </div>

                <Form.Item name="quietHoursEnabled" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Space>
                    <Switch disabled={!notificationsEnabled} />
                    <Typography.Text style={{ color: '#fff' }}>
                      {t('profile.pushNotifications.quietHours.enabled')}
                    </Typography.Text>
                  </Space>
                </Form.Item>

                <Form.Item
                  noStyle
                  shouldUpdate={(prev, cur) => prev.quietHoursEnabled !== cur.quietHoursEnabled}
                >
                  {({ getFieldValue: gfv }) => {
                    const quietEnabled = gfv('quietHoursEnabled') && notificationsEnabled
                    return (
                      <div style={{
                        display: 'flex', gap: 12, marginBottom: 0,
                        opacity: quietEnabled ? 1 : 0.5,
                        pointerEvents: quietEnabled ? 'auto' : 'none'
                      }}>
                        <Form.Item
                          name="quietHoursStart"
                          label={<span style={{ color: '#fff', fontSize: 12 }}>{t('profile.pushNotifications.quietHours.start')}</span>}
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <TimePicker format="HH:mm" style={{ width: '100%' }} disabled={!quietEnabled} />
                        </Form.Item>
                        <div style={{ alignSelf: 'flex-end', paddingBottom: 4, color: '#fff' }}>—</div>
                        <Form.Item
                          name="quietHoursEnd"
                          label={<span style={{ color: '#fff', fontSize: 12 }}>{t('profile.pushNotifications.quietHours.end')}</span>}
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <TimePicker format="HH:mm" style={{ width: '100%' }} disabled={!quietEnabled} />
                        </Form.Item>
                      </div>
                    )
                  }}
                </Form.Item>
              </>
            )
          }}
        </Form.Item>
      </Form>
    </>
  )

  // ── Mobile Drawer header ────────────────────────────────────────────────────

  const mobileDrawerTitle = (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 0'
    }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => setEditing(false)}
        style={{ color: '#fff', fontSize: 18 }}
      />
      <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>
        {t('profile.editProfile')}
      </span>
      <div style={{ width: 40 }} />
    </div>
  )

  // ── Desktop tab items ────────────────────────────────────────────────────────

  const desktopTabItems = [
    {
      key: 'basic',
      label: <span><UserOutlined style={{ marginRight: 6 }} />{t('profile.nameLabel') || '基本信息'}</span>,
      children: (
        <div style={{ padding: '8px 0' }}>
          {renderBasicSection()}
        </div>
      )
    },
    {
      key: 'security',
      label: <span><LockOutlined style={{ marginRight: 6 }} />{t('auth.security') || '安全设置'}</span>,
      children: (
        <div style={{ padding: '8px 0' }}>
          {renderSecuritySection()}
        </div>
      )
    },
    {
      key: 'preferences',
      label: <span><SettingOutlined style={{ marginRight: 6 }} />{t('profile.settings') || '偏好设置'}</span>,
      children: (
        <div style={{ padding: '8px 0' }}>
          {renderPreferencesSection()}
        </div>
      )
    }
  ]

  // ── Page render ──────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      paddingBottom: isMobile ? '80px' : '40px'
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '24px'
        }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            style={{ color: '#fff', fontSize: '20px' }}
          />
          <h1 style={{
            fontSize: '18px', fontWeight: 'bold', color: '#fff',
            margin: 0, textAlign: 'center', flex: 1
          }}>
            {t('profile.title')}
          </h1>
          <div style={{ width: 40, height: 40 }} />
        </div>

        {/* Profile View */}
        <ProfileView
          user={user}
          readOnly={false}
          showEditButton={true}
          onEdit={(u) => handleEdit(u)}
        />
      </div>

      {/* ── Mobile: full-screen right Drawer ─────────────────────────────── */}
      {isMobile && (
        <Drawer
          open={editing}
          placement="right"
          width="100%"
          closable={false}
          title={mobileDrawerTitle}
          footer={null}
          destroyOnHidden
          styles={{
            header: {
              background: '#0d0d0d',
              borderBottom: '1px solid rgba(244,175,37,0.3)',
              padding: '10px 16px'
            },
            body: {
              background: '#0d0d0d',
              padding: '16px'
            }
          }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            style={{ minHeight: 320 }}
            tabBarStyle={{ marginBottom: 16 }}
            items={[
              {
                key: 'basic',
                label: <span><UserOutlined style={{ marginRight: 4 }} />{t('profile.nameLabel')}</span>,
                children: (
                  <div style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
                    {renderBasicSection()}
                  </div>
                )
              },
              {
                key: 'security',
                label: <span><LockOutlined style={{ marginRight: 4 }} />{t('auth.security')}</span>,
                children: (
                  <div style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
                    {renderSecuritySection()}
                  </div>
                )
              },
              {
                key: 'preferences',
                label: <span><SettingOutlined style={{ marginRight: 4 }} />{t('profile.settings')}</span>,
                children: (
                  <div style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
                    {renderPreferencesSection()}
                  </div>
                )
              }
            ]}
          />

          {/* Fixed bottom save button */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))', background: '#0d0d0d',
            borderTop: '1px solid rgba(244,175,37,0.2)'
          }}>
            <Button
              type="primary"
              block
              size="large"
              loading={saving}
              onClick={handleSave}
              style={{
                height: 48, fontSize: 16, fontWeight: 700,
                background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                border: 'none', color: '#111', borderRadius: 10
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </Drawer>
      )}

      {/* ── Desktop: Modal with tabs ──────────────────────────────────────── */}
      {!isMobile && (
        <Modal
          title={t('profile.editProfile')}
          open={editing}
          onOk={handleSave}
          onCancel={() => setEditing(false)}
          confirmLoading={saving}
          width={700}
          centered
          destroyOnHidden
          maskClosable
          styles={{
            body: { background: 'rgba(24,22,17,0.97)', padding: '0 24px 8px' },
            mask: { backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' },
            content: {
              background: 'rgba(24,22,17,0.97)',
              border: '1px solid rgba(244,175,37,0.6)',
              borderRadius: 12,
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            },
            header: {
              background: 'transparent',
              borderBottom: '1px solid rgba(244,175,37,0.3)',
              paddingBottom: 12,
              marginBottom: 0
            }
          }}
          okText={t('common.save')}
          cancelText={t('common.cancel')}
          okButtonProps={{
            style: {
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              border: 'none', color: '#111', fontWeight: 600
            }
          }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            style={{ minHeight: 320 }}
            items={desktopTabItems}
          />
        </Modal>
      )}
    </div>
  )
}

export default Profile
