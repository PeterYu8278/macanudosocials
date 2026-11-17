// User Profile Page
import React, { useState, useEffect } from 'react'
import {
  Button, Modal, Form, Input, message, Switch, Select, Space, Tag,
  Typography, Checkbox, Divider, TimePicker, Drawer, Tabs, Alert
} from 'antd'
import {
  ArrowLeftOutlined, MailOutlined, PhoneOutlined, BellOutlined,
  CalendarOutlined, WalletOutlined, ShoppingOutlined, GiftOutlined,
  SaveOutlined, LockOutlined, SettingOutlined, UserOutlined, LogoutOutlined,
  CloudDownloadOutlined, ClearOutlined, CloseOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import './profile.css'
import { useNavigate } from 'react-router-dom'

import { useAuthStore } from '../../../store/modules/auth'
import { useTranslation } from 'react-i18next'
import { ProfileView } from '../../../components/common/ProfileView'
import ImageUpload from '../../../components/common/ImageUpload'
import { updateDocument, getUserById } from '../../../services/firebase/firestore'
import { logoutUser } from '../../../services/firebase/auth'
import { normalizePhoneNumber } from '../../../utils/phoneNormalization'
import type { User } from '../../../types'
import { auth } from '../../../config/firebase'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { getResponsiveModalConfig, getModalTheme } from '../../../config/modalTheme'
import LanguageSelect from '../../../components/common/LanguageSelect'
import { usePushNotificationStore } from '../../../store/modules/pushNotifications'
import {
  disablePushSubscription,
  requestPushSubscription,
  syncPushSubscriptionToFirestore,
} from '../../../services/oneSignal'
import { usePWA } from '../../../utils/pwa'
import { clearApplicationCache } from '../../../utils/clearApplicationCache'
import { usePhoneChangeVerification } from '../../../hooks/usePhoneChangeVerification'
import { updateMemberPhone } from '../../../services/firebase/memberPhone'
import { MemberEmailError, normalizeMemberEmail, requestMemberEmailVerification, updateMemberEmail, verifyCurrentMemberEmail } from '../../../services/firebase/memberEmail'

const Profile: React.FC = () => {
  const { user, setUser } = useAuthStore()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingForUpdate, setCheckingForUpdate] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [form] = Form.useForm()
  const accountNotificationsEnabled = Form.useWatch('notifications', form) === true
  const { verifyPhoneChange, verifyEmailChange, phoneVerificationModal } = usePhoneChangeVerification()
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailSyncError, setEmailSyncError] = useState('')
  const [emailConfirmation, setEmailConfirmation] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const changeId = params.get('email-change')
    const confirmationToken = params.get('email-token')
    return changeId && confirmationToken ? { changeId, confirmationToken } : null
  })
  useEffect(() => {
    if (emailConfirmation) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])
  const confirmationMatches = !!emailConfirmation && user?.emailChange?.id === emailConfirmation.changeId
    && user.emailChange.proofVersion === 1 && ['awaiting-verification', 'sync-pending'].includes(user.emailChange.status)
  const emailRequestPending = ['requested', 'awaiting-verification', 'sync-pending'].includes(user?.emailChange?.status || '')
  const canCancelEmailRequest = user?.emailChange?.status === 'requested'
    || (user?.emailChange?.status === 'awaiting-verification' && user.emailChange.proofVersion === 1)
  const emailCancelReason = user?.emailChange?.status === 'sync-pending' ? 'profile.emailSync.cancelSyncPending' : 'profile.emailSync.legacyPending'
  const [activeTab, setActiveTab] = useState('basic')
  const pushStatus = usePushNotificationStore((state) => state.status)
  const pushBusy = usePushNotificationStore((state) => state.busy)
  const setPushBusy = usePushNotificationStore((state) => state.setBusy)
  const setPushSnapshot = usePushNotificationStore((state) => state.setSnapshot)
  const { checkForUpdates } = usePWA()

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
  const labelFlex = '120px'

  const buildFormValues = (userData: User) => {
    const pushPrefs = (userData as any)?.preferences?.pushNotifications || {}
    const quietHours = pushPrefs.quietHours || {}
    return {
      displayName: userData.displayName || '',
      email: userData.email || '',
      phone: (userData as any)?.profile?.phone || '',
      gender: userData.profile?.gender,
      race: userData.profile?.race,
      notifications: (userData as any)?.preferences?.notifications ?? true,
      whatsapp: userData.preferences?.whatsapp === true,
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

      const phone = normalizePhoneNumber(values.phone)
      if (!phone) throw new Error(t('profile.phoneInvalidFormat'))
      // Re-save unchanged profile numbers too: older accounts may not have an Auth phone.
      if (auth.currentUser?.phoneNumber !== phone || normalizePhoneNumber(user.profile?.phone || '') !== phone) {
        if (!await verifyPhoneChange({ memberName: user.displayName || user.email || '', phone })) return
        await updateMemberPhone(user.id, phone)
      }

      const newEmail = normalizeMemberEmail(values.email || '')
      const emailChanged = newEmail !== normalizeMemberEmail(user.email || '')
      if (emailChanged) {
        if (!await verifyEmailChange({ memberName: user.displayName, email: newEmail })) return
        await requestMemberEmailVerification(user.id, newEmail)
        message.info(t('profile.emailSync.sent', { email: newEmail }))
      }

      const updates: any = {
        displayName: values.displayName,
        'profile.gender': values.gender || null,
        'profile.race': values.race || null,
        'preferences.notifications': values.notifications,
        'preferences.whatsapp': values.whatsapp === true,
        ...(values.whatsapp !== user?.preferences?.whatsapp ? { 'preferences.whatsappConsentUpdatedAt': new Date() } : {}),
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

      if (values.newPassword) {
        if (!currentUser) throw new Error('not logged in')
        if (values.currentPassword) {
          const credential = EmailAuthProvider.credential(currentUser.email || '', values.currentPassword)
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
          setUser({ ...user, displayName: values.displayName, email: updates.email || user.email, profile: { ...(user as any)?.profile, phone: normalizePhoneNumber(values.phone), gender: values.gender, race: values.race }, preferences: { ...(user as any)?.preferences, notifications: values.notifications, whatsapp: values.whatsapp === true, locale: values.language || (user as any)?.preferences?.locale, pushNotifications: { types: { activity: values.pushActivity, points: values.pushPoints, order: values.pushOrder, marketing: values.pushMarketing }, quietHours: { enabled: values.quietHoursEnabled, start: values.quietHoursStart ? values.quietHoursStart.format('HH:mm') : undefined, end: values.quietHoursEnd ? values.quietHoursEnd.format('HH:mm') : undefined } } } } as any)
        }
      } catch {
        setUser({ ...user, displayName: values.displayName, email: updates.email || user.email, profile: { ...(user as any)?.profile, phone: normalizePhoneNumber(values.phone), gender: values.gender, race: values.race }, preferences: { ...(user as any)?.preferences, notifications: values.notifications, whatsapp: values.whatsapp === true, locale: values.language || (user as any)?.preferences?.locale, pushNotifications: { types: { activity: values.pushActivity, points: values.pushPoints, order: values.pushOrder, marketing: values.pushMarketing }, quietHours: { enabled: values.quietHoursEnabled, start: values.quietHoursStart ? values.quietHoursStart.format('HH:mm') : undefined, end: values.quietHoursEnd ? values.quietHoursEnd.format('HH:mm') : undefined } } } } as any)
      }

      if (values.language && values.language !== i18n.language) {
        try { await i18n.changeLanguage(values.language) } catch {}
      }

      message.success(t('profile.saveSuccess'))
      setEditing(false)
    } catch (err: any) {
      if (err instanceof MemberEmailError) {
        message.error(err.message)
      } else if (err?.code === 'auth/wrong-password') {
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

  const handleEmailAction = async (action: 'send' | 'sync' | 'cancel' | 'verify' | 'confirm') => {
    if (!user || emailBusy) return
    setEmailBusy(true)
    try {
      if (action === 'sync') {
        await auth.currentUser?.reload()
        await updateMemberEmail(user.id, 'sync')
        setEmailSyncError('')
        message.success(t('profile.emailSync.synced'))
      } else {
        const email = user.emailChange?.email || user.email
        if (!await verifyEmailChange({ memberName: user.displayName, email })) return
        if (action === 'send') {
          await requestMemberEmailVerification(user.id, email)
          message.info(t('profile.emailSync.sent', { email }))
        } else if (action === 'verify') {
          await verifyCurrentMemberEmail()
          message.info(t('profile.emailSync.sent', { email: user.email }))
        } else if (action === 'confirm') {
          if (!emailConfirmation) throw new MemberEmailError('confirmation-invalid')
          await updateMemberEmail(user.id, 'confirm', undefined, emailConfirmation)
          setEmailConfirmation(null)
          await auth.currentUser?.reload()
          message.success(t('profile.emailSync.synced'))
        } else {
          await updateMemberEmail(user.id, 'cancel')
          message.success(t('profile.emailSync.cancelled'))
        }
      }
      const latest = await getUserById(user.id)
      if (latest) setUser(latest)
    } catch (error) {
      const reason = error instanceof Error ? error.message : t('profile.emailSync.failed')
      if (action === 'sync') setEmailSyncError(reason)
      message.error(reason)
    } finally { setEmailBusy(false) }
  }

  useEffect(() => {
    if (!user?.id || !auth.currentUser) return
    let cancelled = false
    const synchronize = async () => {
      try {
        await auth.currentUser!.reload()
        const account = auth.currentUser
        if (!account || (normalizeMemberEmail(account.email || '') === normalizeMemberEmail(user.email || '')
          && user.emailAuth?.verified === account.emailVerified && !window.location.search.includes('emailSync=1'))) return
        await updateMemberEmail(user.id, 'sync')
        const latest = await getUserById(user.id)
        if (!cancelled && latest) { setUser(latest); setEmailSyncError('') }
      } catch (error) {
        if (!cancelled && !(error instanceof MemberEmailError && error.code === 'verification-pending')) {
          setEmailSyncError(error instanceof Error ? error.message : t('profile.emailSync.failed'))
        }
      }
    }
    const onFocus = () => { if (document.visibilityState === 'visible') void synchronize() }
    void synchronize()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [user?.id, user?.email, user?.emailAuth?.verified])

  const handleLogout = async () => {
    try {
      const result = await logoutUser()
      if (result.success) {
        useAuthStore.getState().logout()
        message.success(t('auth.logoutSuccess', { defaultValue: '已登出' }))
        navigate('/')
      } else {
        message.error(result.error?.message || t('auth.logoutFailed', { defaultValue: '登出失败' }))
      }
    } catch (error: any) {
      message.error(error.message || t('auth.logoutFailed', { defaultValue: '登出失败' }))
    }
  }

  const handleCheckForUpdates = async () => {
    if (checkingForUpdate) return
    setCheckingForUpdate(true)
    try {
      const result = await checkForUpdates()
      if (result === 'available' || result === 'updated') {
        message.success(t('profile.systemUpdate.updateReady'))
        window.setTimeout(() => window.location.reload(), 800)
      } else if (result === 'up-to-date') {
        message.success(t('profile.systemUpdate.upToDate'))
      } else if (result === 'unsupported') {
        message.info(t('profile.systemUpdate.unavailable'))
      } else {
        message.error(t('profile.systemUpdate.failed'))
      }
    } finally {
      setCheckingForUpdate(false)
    }
  }

  const handleEnablePush = async () => {
    if (!user || pushBusy || !accountNotificationsEnabled) return
    setPushBusy(true)
    try {
      const snapshot = await requestPushSubscription()
      setPushSnapshot(snapshot)
      await syncPushSubscriptionToFirestore(user, snapshot)

      if (snapshot.status === 'subscribed') {
        message.success(t('profile.pushNotifications.enabled'))
      } else if (snapshot.status === 'denied') {
        message.warning(t('profile.pushNotifications.permissionDeniedHint'))
      } else {
        message.warning(t('profile.pushNotifications.requestFailed'))
      }
    } catch (error) {
      console.error('[Profile] Failed to enable push notifications:', error)
      message.error(t('profile.pushNotifications.requestFailed'))
    } finally {
      setPushBusy(false)
    }
  }

  const handleDisablePush = async () => {
    if (!user || pushBusy) return
    setPushBusy(true)
    try {
      const snapshot = await disablePushSubscription()
      setPushSnapshot(snapshot)
      await syncPushSubscriptionToFirestore(user, snapshot)
      message.success(t('profile.pushNotifications.disabled'))
    } catch (error) {
      console.error('[Profile] Failed to disable push notifications:', error)
      message.error(t('profile.pushNotifications.disableFailed'))
    } finally {
      setPushBusy(false)
    }
  }

  // ── Shared form sections ────────────────────────────────────────────────────

  const renderBasicSection = () => (
    <Form
      className="profile-basic-form"
      form={form}
      layout="horizontal"
      labelCol={{ flex: isMobile ? '96px' : labelFlex }}
      wrapperCol={{ flex: '1 1 0' }}
      labelAlign="left"
      labelWrap
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
          width={96}
          height={96}
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
              if (!value || normalizeMemberEmail(value) === normalizeMemberEmail(user?.email || '')) return Promise.resolve()
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

      <Form.Item
        name="gender"
        label={<span style={{ color: '#fff' }}>{t('profile.gender')}</span>}
        style={{ marginBottom: 8 }}
      >
        <Select
          allowClear
          placeholder={t('profile.selectGender')}
          options={[
            { value: 'male', label: t('profile.genderOptions.male') },
            { value: 'female', label: t('profile.genderOptions.female') },
          ]}
        />
      </Form.Item>

      <Form.Item
        name="race"
        label={<span style={{ color: '#fff' }}>{t('profile.race')}</span>}
        style={{ marginBottom: 8 }}
      >
        <Select
          allowClear
          placeholder={t('profile.selectRace')}
          options={[
            { value: 'chinese', label: t('profile.raceOptions.chinese') },
            { value: 'indian', label: t('profile.raceOptions.indian') },
            { value: 'malay', label: t('profile.raceOptions.malay') },
            { value: 'other', label: t('profile.raceOptions.other') },
          ]}
        />
      </Form.Item>
    </Form>
  )

  const renderSecuritySection = () => (
    <Form
      className="profile-inline-form"
      colon={false}
      form={form}
      layout="horizontal"
      labelCol={{ flex: '160px' }}
      wrapperCol={{ flex: '1 1 0' }}
      labelAlign="left"
      labelWrap
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

  const handleClearCache = async () => {
    if (clearingCache) return
    setClearingCache(true)
    try {
      await clearApplicationCache()
      message.success(t('profile.cache.cleared'))
    } catch (error) {
      console.error('[Profile] Failed to clear application cache:', error)
      message.error(t('profile.cache.failed'))
    } finally {
      setClearingCache(false)
    }
  }

  const renderPreferencesSection = () => (
    <div className="profile-preferences">
      <Form
        className="profile-inline-form"
        colon={false}
        form={form}
        layout="horizontal"
        labelCol={{ flex: '160px' }}
        wrapperCol={{ flex: '1 1 0' }}
        labelAlign="left"
        labelWrap
      >
        <Form.Item
          name="language"
          label={<span style={{ color: '#fff' }}>{t('profile.language')}</span>}
          style={{ marginBottom: 0 }}
        >
          <LanguageSelect />
        </Form.Item>
        <Form.Item name="whatsapp" valuePropName="checked" label={t('whatsappManagement.consentLabel')} style={{ marginTop: 16, marginBottom: 0 }}>
          <Switch />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '16px 0', borderColor: 'rgba(255,255,255,0.1)' }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 12,
      }}>
        <Space size={8}>
          <CloudDownloadOutlined style={{ color: '#F4AF25' }} />
          <Typography.Text style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
            {t('profile.systemUpdate.title')}
          </Typography.Text>
        </Space>
        <Button
          icon={<CloudDownloadOutlined />}
          loading={checkingForUpdate}
          onClick={handleCheckForUpdates}
        >
          {checkingForUpdate ? t('profile.systemUpdate.checking') : t('profile.systemUpdate.check')}
        </Button>
      </div>

      <Divider style={{ margin: '16px 0', borderColor: 'rgba(255,255,255,0.1)' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Space size={8}>
          <ClearOutlined style={{ color: '#F4AF25' }} />
          <Typography.Text style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
            {t('profile.cache.title')}
          </Typography.Text>
        </Space>
        <Button icon={<ClearOutlined />} loading={clearingCache} onClick={handleClearCache}>
          {t(clearingCache ? 'profile.cache.clearing' : 'profile.cache.clear')}
        </Button>
      </div>

      <Divider style={{ margin: '16px 0', borderColor: 'rgba(255,255,255,0.1)' }} />

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <BellOutlined style={{ marginRight: 8, color: '#F4AF25' }} />
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
          {t('profile.pushNotifications.sectionTitle')}
        </span>
      </div>

      <Form form={form} component={false}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0' }}>
          <Typography.Text style={{ color: '#fff', minWidth: 0 }}>{t('profile.pushNotifications.accountNotifications')}</Typography.Text>
          <Form.Item name="notifications" valuePropName="checked" noStyle>
            <Switch className="gold-switch" aria-label={t('profile.pushNotifications.accountNotifications')} />
          </Form.Item>
        </div>
      </Form>
      <div style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', marginBottom: 12 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: pushStatus === 'denied' ? 8 : 0,
          flexWrap: 'wrap',
        }}>
          <Space size={8} wrap>
            <Typography.Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>
              {t('profile.pushNotifications.devicePush')}
            </Typography.Text>
            <Tag color={pushStatus === 'subscribed' ? 'green' : pushStatus === 'denied' ? 'red' : 'gold'}>
              {t(`profile.pushNotifications.status.${pushStatus}`)}
            </Tag>
          </Space>
          {pushStatus === 'subscribed' ? (
            <Button size="small" icon={<CloseOutlined />} danger loading={pushBusy} onClick={handleDisablePush}>
              {t('profile.pushNotifications.disableDevice')}
            </Button>
          ) : !['unsupported', 'loading', 'idle', 'denied'].includes(pushStatus) ? (
            <Button size="small" icon={<BellOutlined />} type="primary" disabled={!accountNotificationsEnabled} loading={pushBusy} onClick={handleEnablePush}>
              {t('profile.pushNotifications.enableDevice')}
            </Button>
          ) : null}
        </div>
        {pushStatus === 'denied' && (
          <Typography.Text style={{ color: 'rgba(255,255,255,0.68)', fontSize: 12 }}>
            {t('profile.pushNotifications.permissionDeniedHint')}
          </Typography.Text>
        )}
      </div>

      {!['subscribed', 'denied', 'unsupported', 'loading', 'idle'].includes(pushStatus) && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'rgba(244,175,37,0.1)',
          border: '1px solid rgba(244,175,37,0.6)',
          marginBottom: 12
        }}>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
            {t('profile.pushNotifications.permissionRequiredHint')}
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
            const notificationsEnabled = getFieldValue('notifications') === true
            return (
              <>
                <div style={{
                  padding: '12px 0',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  marginBottom: 12,
                  opacity: notificationsEnabled ? 1 : 0.5,
                }}>
                  <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                    {t('profile.pushNotifications.notificationTypes')}
                  </Typography.Text>
                  <Form.Item name="pushActivity" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox disabled={!notificationsEnabled}><CalendarOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.activity')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushPoints" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox disabled={!notificationsEnabled}><WalletOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.points')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushOrder" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox disabled={!notificationsEnabled}><ShoppingOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.order')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="pushMarketing" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Checkbox disabled={!notificationsEnabled}><GiftOutlined style={{ marginRight: 8, color: '#F4AF25' }} />{t('profile.pushNotifications.types.marketing')}</Checkbox>
                  </Form.Item>
                </div>

                <Form.Item name="quietHoursEnabled" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Space>
                    <Switch className="gold-switch" disabled={!notificationsEnabled} />
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
    </div>
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
      {phoneVerificationModal}
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {emailConfirmation && <Alert className="profile-email-status" type="info" showIcon
          message={t('profile.emailSync.confirmLinkTitle')}
          description={<div>
            <div className="profile-email-status__email">{confirmationMatches ? user?.emailChange?.email : t('profile.emailSync.invalidLink')}</div>
            <div className="profile-email-status__actions">
            <Button icon={<MailOutlined />} disabled={emailBusy || !confirmationMatches}
              onClick={() => { void handleEmailAction('confirm') }}>{t('profile.emailSync.confirmNewEmail')}</Button>
            </div>
          </div>} />}
        {(emailSyncError || ['requested', 'awaiting-verification', 'sync-pending'].includes(user?.emailChange?.status || '') || user?.emailAuth?.verified === false) && (
          <Alert className="profile-email-status" type="warning" showIcon
            message={<span style={{ fontWeight: 600 }}>{emailSyncError ? t('profile.emailSync.syncFailedTitle')
              : t(`profile.emailSync.${user?.emailChange?.status === 'requested' ? 'requestTitle'
                : user?.emailChange?.status === 'awaiting-verification' ? 'awaitingTitle'
                : user?.emailChange?.status === 'sync-pending' ? 'syncTitle' : 'unverified'}`)}</span>}
            description={<div>
              {user?.emailChange && ['requested', 'awaiting-verification', 'sync-pending'].includes(user.emailChange.status) && (
                <div className="profile-email-status__email">{user.emailChange.email}</div>
              )}
              {(emailSyncError || user?.emailChange?.status === 'awaiting-verification') && (
                <div className="profile-email-status__notice">{emailSyncError || t(user?.emailChange?.proofVersion === 1 ? 'profile.emailSync.revocableNotice' : 'profile.emailSync.issuedLinkNotice')}</div>
              )}
              <div className="profile-email-status__actions">
                {user?.emailChange && (user.emailChange.status === 'requested' || (user.emailChange.status === 'awaiting-verification' && user.emailChange.proofVersion === 1)) && <Button className="profile-email-status__send" icon={<MailOutlined />} disabled={emailBusy} onClick={() => { void handleEmailAction('send') }}>{t(user.emailChange.status === 'requested' ? 'profile.emailSync.send' : 'profile.emailSync.resend')}</Button>}
                {user?.emailAuth?.verified === false && !['requested', 'awaiting-verification', 'sync-pending'].includes(user.emailChange?.status || '') && <Button icon={<MailOutlined />} disabled={emailBusy} onClick={() => { void handleEmailAction('verify') }}>{t('profile.emailSync.verifyCurrent')}</Button>}
                <Button icon={<CloudDownloadOutlined />} disabled={emailBusy} onClick={() => { void handleEmailAction('sync') }}>{t('profile.emailSync.retry')}</Button>
                {emailRequestPending && <Button danger icon={<CloseOutlined />}
                  disabled={emailBusy || !canCancelEmailRequest} aria-describedby={!canCancelEmailRequest ? 'email-cancel-reason' : undefined}
                  onClick={() => { void handleEmailAction('cancel') }}>{t('profile.emailSync.cancel')}</Button>}
              </div>
              {emailRequestPending && !canCancelEmailRequest && <div id="email-cancel-reason" className="profile-email-status__reason">{t(emailCancelReason)}</div>}
            </div>} />
        )}
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
          onLogout={handleLogout}
        />
      </div>

      {/* ── Mobile: full-screen right Drawer ─────────────────────────────── */}
      {isMobile && (
        <Drawer
          open={editing}
          zIndex={2000}
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
          zIndex={2000}
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
