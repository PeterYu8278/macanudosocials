// Google 登录后完善用户信息页面
import React, { useState, useEffect, useRef } from 'react'
import { Form, Input, Button, Card, Typography, Space, App, Spin, Avatar, Divider } from 'antd'
import { UserOutlined, LockOutlined, PhoneOutlined, LoadingOutlined, LogoutOutlined, GiftOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'
import { auth } from '../../config/firebase'
import { signOut } from 'firebase/auth'
import { getUserByMemberId } from '../../utils/memberId'
import { useAuthStore } from '../../store/modules/auth'
import type { User as FirebaseUser } from 'firebase/auth'
import type { AppConfig } from '../../types'
import { getAppConfig } from '../../services/firebase/appConfig'

const { Title, Text } = Typography

const CompleteProfile: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null)
  const touchStartY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [form] = Form.useForm()
  
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { message } = App.useApp() // ✅ 使用 App.useApp() 获取 message 实例
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  
  // 获取用户原本想访问的页面
  const from = location.state?.from?.pathname || '/'

  // 加载应用配置
  useEffect(() => {
    const loadAppConfig = async () => {
      const config = await getAppConfig()
      if (config) {
        setAppConfig(config)
      }
    }
    loadAppConfig()
  }, [])
  
  // 下拉刷新处理
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isRefreshing) return
    
    const touchY = e.touches[0].clientY
    const pullDelta = touchY - touchStartY.current
    
    if (pullDelta > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(pullDelta, 150))
      if (pullDelta > 10) {
        e.preventDefault()
      }
    }
  }

  const handleTouchEnd = () => {
    if (pullDistance > 80 && !isRefreshing) {
      setIsRefreshing(true)
      setPullDistance(80)
      setTimeout(() => {
        window.location.reload()
      }, 300)
    } else {
      setPullDistance(0)
    }
  }

  // 自动填充 URL 中的引荐码
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const refCode = params.get('ref');
    if (refCode) {
      form.setFieldsValue({ referralCode: refCode.toUpperCase() });
      message.info(t('auth.referralCodeAutoFilled'));
    }
  }, [location, form]);

  // 如果用户未登录或已完善信息，重定向
  useEffect(() => {
    const checkAndSetup = async () => {
      // 等待 Firebase Auth 状态同步（最多 2 秒）
      let currentUser = auth.currentUser;
      let attempts = 0;
      const maxAttempts = 4;
      
      while (!currentUser && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        currentUser = auth.currentUser;
        attempts++;
      }
      
      if (!currentUser) {
        navigate('/', { replace: true })
        return
      }
      
      // 保存 Google 用户信息用于显示
      setGoogleUser(currentUser)
      
      // 预填 Google 用户的显示名称
      if (currentUser.displayName) {
        form.setFieldsValue({ displayName: currentUser.displayName })
      }
      
      // 检查用户是否已有完整信息
      const checkUserProfile = async () => {
        const { getUserData } = await import('../../services/firebase/auth')
        const userData = await getUserData(currentUser.uid)
        
        // 检查完整资料：名字、电邮、手机号
        const isProfileComplete = userData?.displayName && userData?.email && userData?.profile?.phone
        if (isProfileComplete) {
          // 用户已完善信息，重定向到原页面或首页
          navigate(from, { replace: true })
        }
      }
      
      checkUserProfile()
    }
    
    checkAndSetup()
  }, [navigate, form])

  const onFinish = async (values: { 
    displayName: string
    phone: string
    password: string
    referralCode?: string
  }) => {
    const currentUser = auth.currentUser
    
    if (!currentUser) {
      message.error(t('auth.userNotFoundRelogin'))
      navigate('/')
      return
    }

    // ✅ 获取 Firestore User ID（优先使用 sessionStorage，否则使用 Firebase UID）
    const firestoreUserId = sessionStorage.getItem('firestoreUserId') || currentUser.uid;

    setLoading(true)
    try {
      // 标准化手机号
      const normalizedPhone = normalizePhoneNumber(values.phone)
      
      if (!normalizedPhone) {
        setLoading(false)
        return
      }

      // ✅ 调用完善用户信息的服务函数（传递 firestoreUserId）
      const { completeGoogleUserProfile } = await import('../../services/firebase/auth')
      const result = await completeGoogleUserProfile(
        firestoreUserId,  // ✅ 使用 firestoreUserId 而不是 Firebase UID
        values.displayName,
        normalizedPhone,
        values.password,
        values.referralCode
      )

      if (result.success) {
        // ✅ 如果是账户合并，显示特殊消息
        const appName = appConfig?.appName || 'Cigar Club'
        const successMessage = (result as any).mergedUserId
          ? t('auth.accountMergedSuccess')
          : t('auth.profileCompletedSuccess', { appName });
        
        message.success(successMessage);
        
        // ✅ 等待 Firestore 写入完成，然后手动设置用户状态
        const setupUserState = async () => {
            // 等待 800ms 让 Firestore 写入完成
            await new Promise(resolve => setTimeout(resolve, 800));
          
          // ✅ 如果是账户合并，使用合并后的用户 ID
          const finalUserId = (result as any).mergedUserId || firestoreUserId;
          
          // 更新 sessionStorage
          sessionStorage.setItem('firestoreUserId', finalUserId);
            
            const { getUserData } = await import('../../services/firebase/auth');
          const userData = await getUserData(finalUserId);
            
            if (userData) {
              useAuthStore.getState().setUser(userData);
              useAuthStore.getState().setLoading(false);
              
            // 等待 500ms 让 React 重渲染完成
              await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          navigate(from, { replace: true });
        };
        
        setupUserState();
      } else {
        message.error((result as any).error?.message || t('auth.saveProfileFailed'))
      }
    } catch (error) {
      message.error(t('auth.saveProfileFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 退出登录并返回登录页
  const handleLogout = async () => {
    try {
      await signOut(auth)
      message.info(t('auth.loggedOut'))
      navigate('/', { replace: true })
    } catch (error) {
      message.error(t('auth.signOutFailed'))
    }
  }

  return (
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          width: '100%',
          padding: '0 25px',
          position: 'relative',
          boxSizing: 'border-box',
          transform: `translateY(${pullDistance}px)`,
          transition: isRefreshing ? 'transform 0.3s ease' : pullDistance > 0 ? 'none' : 'transform 0.3s ease'
        }}>
      {/* 下拉刷新指示器 */}
      {pullDistance > 0 && (
        <div style={{
          position: 'absolute',
          top: `-${Math.min(pullDistance, 80)}px`,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          color: '#ffd700',
          fontSize: '14px',
          opacity: pullDistance / 80,
          transition: 'opacity 0.2s ease'
        }}>
          <Spin 
            indicator={<LoadingOutlined style={{ fontSize: 24, color: '#ffd700' }} spin />}
            spinning={isRefreshing}
          />
          <span>{isRefreshing ? t('common.refreshing') : pullDistance > 80 ? t('common.releaseToRefresh') : t('common.pullToRefresh')}</span>
        </div>
      )}
      
      <Card
        styles={{ body: { padding: '28px 24px 24px' } }}
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'linear-gradient(135deg, rgba(26,26,26,0.95) 0%, rgba(45,45,45,0.9) 100%)',
          border: '1px solid rgba(255,215,0,0.25)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,215,0,0.05)',
          backdropFilter: 'blur(12px)',
          position: 'relative',
          zIndex: 1
        }}
      >
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Title level={3} style={{
            margin: 0,
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 700,
            letterSpacing: 1
          }}>
            {t('auth.completeProfileTitle')}
          </Title>
          <Text style={{ color: '#888', fontSize: 13, marginTop: 4, display: 'block' }}>
            {t('auth.completeProfileSubtitle')}
          </Text>
        </div>

        {/* Google 账户信息 */}
        {googleUser && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(255,215,0,0.06)',
            borderRadius: 10,
            padding: '10px 14px',
            border: '1px solid rgba(255,215,0,0.18)',
            marginBottom: 20
          }}>
            <Avatar
              src={googleUser.photoURL}
              icon={<UserOutlined />}
              size={40}
              style={{ border: '1.5px solid rgba(255,215,0,0.5)', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#c0c0c0', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {googleUser.email}
              </div>
              <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                {t('auth.googleAccountInfo')}
              </div>
            </div>
          </div>
        )}

        <Form
          form={form}
          name="complete-profile"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          {/* 姓名 */}
          <Form.Item
            name="displayName"
            style={{ marginBottom: 12 }}
            rules={[
              { required: true, message: t('profile.nameRequired') },
              { min: 2, message: t('auth.nameMinLength') }
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#ffd700' }} />}
              placeholder={t('auth.name')}
              style={{ background: 'rgba(45,45,45,0.8)', border: '1px solid #444', borderRadius: 8, color: '#f8f8f8' }}
            />
          </Form.Item>

          {/* 手机号 */}
          <Form.Item
            name="phone"
            style={{ marginBottom: 12 }}
            rules={[
              { required: true, message: t('auth.phoneOnlyRequired') },
              {
                pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/,
                message: t('profile.phoneInvalidLength')
              },
              {
                validator: async (_, value) => {
                  if (!value) return Promise.resolve()
                  const formatPattern = /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/
                  if (!formatPattern.test(value)) return Promise.resolve()
                  const normalized = normalizePhoneNumber(value)
                  if (!normalized) return Promise.resolve()
                  try {
                    const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
                    const { db } = await import('../../config/firebase')
                    const phoneSnap = await getDocs(query(collection(db, 'users'), where('profile.phone', '==', normalized), limit(1)))
                    if (!phoneSnap.empty) {
                      const existingEmail = phoneSnap.docs[0].data().email
                      if (existingEmail && existingEmail !== '') return Promise.reject(new Error(t('profile.phoneUsed')))
                    }
                  } catch {}
                  return Promise.resolve()
                }
              }
            ]}
            validateTrigger={['onBlur', 'onChange']}
            validateDebounce={500}
          >
            <Input
              prefix={<PhoneOutlined style={{ color: '#ffd700' }} />}
              placeholder={t('auth.phonePlaceholder')}
              onInput={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/[^\d+\s-]/g, '') }}
              style={{ background: 'rgba(45,45,45,0.8)', border: '1px solid #444', borderRadius: 8, color: '#f8f8f8' }}
            />
          </Form.Item>

          {/* 密码 */}
          <Form.Item
            name="password"
            style={{ marginBottom: 12 }}
            rules={[
              { required: true, message: t('auth.setPasswordRequired') },
              { min: 6, message: t('auth.passwordTooShort') }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#ffd700' }} />}
              placeholder={t('auth.setPasswordPlaceholder')}
              style={{ background: 'rgba(45,45,45,0.8)', border: '1px solid #444', borderRadius: 8, color: '#f8f8f8' }}
            />
          </Form.Item>

          {/* 引荐码（可选） */}
          <Form.Item
            name="referralCode"
            style={{ marginBottom: 20 }}
            rules={[
              {
                validator: async (_, value) => {
                  if (!value || value.trim() === '') return Promise.resolve()
                  const normalized = value.trim().toUpperCase()
                  try {
                    const result = await getUserByMemberId(normalized)
                    if (!result.success) return Promise.reject(new Error(result.error || t('auth.referralCodeNotFound')))
                    return Promise.resolve()
                  } catch {
                    return Promise.reject(new Error(t('auth.referralCodeVerifyFailed')))
                  }
                }
              }
            ]}
            validateTrigger={['onBlur', 'onChange']}
            validateDebounce={500}
          >
            <Input
              prefix={<GiftOutlined style={{ color: '#ffd700' }} />}
              placeholder={t('auth.referralCode')}
              maxLength={20}
              onInput={(e) => { e.currentTarget.value = e.currentTarget.value.toUpperCase() }}
              style={{ background: 'rgba(45,45,45,0.8)', border: '1px solid #444', borderRadius: 8, color: '#f8f8f8' }}
            />
          </Form.Item>

          {/* 提交 */}
          <Form.Item style={{ marginBottom: 10 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 48,
                background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                border: 'none',
                borderRadius: 10,
                color: '#1a1000',
                fontSize: 16,
                fontWeight: 700,
                boxShadow: '0 4px 20px rgba(255,215,0,0.25)'
              }}
            >
              {t('auth.completeRegistration')}
            </Button>
          </Form.Item>

          {/* 返回登录 */}
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              disabled={loading}
              block
              style={{ color: '#666', fontSize: 13 }}
            >
              {t('auth.backToLogin')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

export default CompleteProfile

