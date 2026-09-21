// 登录页面
import React, { useState, useEffect, useRef } from 'react'
import { Form, Input, Button, Card, Typography, Space, App, Divider, Spin, Modal } from 'antd'
import { UserOutlined, LockOutlined, GoogleOutlined, LoadingOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { loginWithEmailOrPhone, loginWithGoogle, handleGoogleRedirectResult, sendPasswordResetEmailFor, resetPasswordByPhone } from '../../services/firebase/auth'
import { useAuthStore } from '../../store/modules/auth'
import { useTranslation } from 'react-i18next'
import { identifyInputType, normalizePhoneNumber, isValidEmail } from '../../utils/phoneNormalization'
import { getAppConfig } from '../../services/firebase/appConfig'
import type { AppConfig } from '../../types'

const { Title, Text } = Typography

const Login: React.FC = () => {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState<string>('')
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [resetPasswordVisible, setResetPasswordVisible] = useState(false)
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false)
  const [resetPasswordForm] = Form.useForm()
  const touchStartY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const navigate = useNavigate()
  const location = useLocation()
  const { user, setUser } = useAuthStore()
  const { t } = useTranslation()
  const hasCheckedRedirect = useRef(false) // 防止 StrictMode 重复调用
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [resetPasswordCooldown, setResetPasswordCooldown] = useState<number | null>(null) // 剩余冷却时间（秒）
  const [logoError, setLogoError] = useState(false) // Logo 加载错误状态

  const from = location.state?.from?.pathname || '/'

  // 从 localStorage 获取上次发送重置密码的时间
  const getLastResetPasswordTime = (): number | null => {
    try {
      const stored = localStorage.getItem('resetPasswordLastSendTime')
      if (stored) {
        const timestamp = parseInt(stored, 10)
        // 检查是否已过期（超过1分钟）
        const now = Date.now()
        const oneMinute = 60 * 1000
        if (now - timestamp < oneMinute) {
          return timestamp
        } else {
          // 已过期，清除存储
          localStorage.removeItem('resetPasswordLastSendTime')
          return null
        }
      }
      return null
    } catch {
      return null
    }
  }

  // 保存上次发送重置密码的时间到 localStorage
  const saveLastResetPasswordTime = (timestamp: number) => {
    try {
      localStorage.setItem('resetPasswordLastSendTime', timestamp.toString())
    } catch (error) {
      console.error('[saveLastResetPasswordTime] 保存失败:', error)
    }
  }

  // 加载应用配置
  useEffect(() => {
    const loadAppConfig = async () => {
      setConfigLoading(true)
      try {
        const config = await getAppConfig()
        if (config) {
          setAppConfig(config)
        } else {
          // 如果配置加载失败，使用默认禁用状态
          setAppConfig({
            id: 'default',
            auth: {
              disableGoogleLogin: true,
              disableEmailLogin: true,
            },
          } as AppConfig)
        }
      } finally {
        setConfigLoading(false)
      }
    }
    loadAppConfig()
  }, [])

  // 重置密码冷却时间倒计时
  useEffect(() => {
    if (!resetPasswordVisible) return

    const updateCooldown = () => {
      const lastSendTime = getLastResetPasswordTime()
      if (lastSendTime === null) {
        setResetPasswordCooldown(null)
        return
      }

      const now = Date.now()
      const timeSinceLastSend = now - lastSendTime
      const oneMinute = 60 * 1000

      if (timeSinceLastSend < oneMinute) {
        const remainingSeconds = Math.ceil((oneMinute - timeSinceLastSend) / 1000)
        setResetPasswordCooldown(remainingSeconds)
      } else {
        setResetPasswordCooldown(null)
        // 冷却时间已过，清除存储
        localStorage.removeItem('resetPasswordLastSendTime')
      }
    }

    updateCooldown()
    const interval = setInterval(updateCooldown, 1000)

    return () => clearInterval(interval)
  }, [resetPasswordVisible])

  // 下拉刷新处理
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isRefreshing) return

    const touchY = e.touches[0].clientY
    const pullDelta = touchY - touchStartY.current

    // 只在页面顶部且向下拖动时才触发
    if (pullDelta > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(pullDelta, 150))
      // 阻止默认滚动行为
      if (pullDelta > 10) {
        e.preventDefault()
      }
    }
  }

  const handleTouchEnd = () => {
    if (pullDistance > 80 && !isRefreshing) {
      // 触发刷新
      setIsRefreshing(true)
      setPullDistance(80)

      // 延迟刷新以显示动画
      setTimeout(() => {
        window.location.reload()
      }, 300)
    } else {
      // 回弹
      setPullDistance(0)
    }
  }

  // 如果用户已登录，根据资料完整性重定向
  useEffect(() => {
    if (user) {
      const isProfileIncomplete = !user.displayName || !user.email || !user.profile?.phone
      if (isProfileIncomplete) {
        // 资料不完整，重定向到完善资料页面
        navigate('/auth/complete-profile', { replace: true })
      } else {
        // 资料完整，重定向到首页
        navigate('/', { replace: true })
      }
    }
  }, [user, navigate])

  // 检查 Google 重定向登录结果
  useEffect(() => {
    // 防止 StrictMode 导致的重复调用
    if (hasCheckedRedirect.current) {
      return;
    }

    const checkRedirectResult = async () => {
      hasCheckedRedirect.current = true;
      setLoading(true)
      try {
        const result = await handleGoogleRedirectResult()

        if (result.success) {
          if ((result as any).needsProfile) {
            message.info(t('auth.completeProfileInfo'))
            navigate('/auth/complete-profile', { replace: true })
          } else {
            message.success(t('auth.loginSuccess'))
            navigate('/', { replace: true })
          }
        } else if (!result.noResult) {
          message.error(result.error?.message || t('auth.loginFailed'))
        }
      } catch (error) {
      } finally {
        setLoading(false)
      }
    }

    checkRedirectResult()
  }, [navigate, t])

  const checkSubscription = (): boolean => {
    if (appConfig?.subscription?.isActive) {
      const expiryDate = new Date(appConfig.subscription.expiryDate);
      if (new Date() > expiryDate) {
        setLoginError(t('auth.subscriptionExpired'));
        return false;
      }
    }
    return true;
  };

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true)
    setLoginError('') // 清除之前的错误

    if (!checkSubscription()) {
      setLoading(false);
      return;
    }

    try {
      const result = await loginWithEmailOrPhone(values.email, values.password)
      if (result.success) {
        message.success(t('auth.loginSuccess'))
        navigate('/', { replace: true })
      } else {
        // 使用 placeholder 显示错误
        setLoginError(t('auth.loginFailedPrefix') + ((result as any).error?.message || t('auth.loginFailed')))
      }
    } catch (error) {
      setLoginError(t('auth.loginFailedPrefix') + t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  const onGoogle = async () => {
    setLoading(true)
    setLoginError('') // 清除之前的错误

    if (!checkSubscription()) {
      setLoading(false);
      return;
    }

    try {
      const res = await loginWithGoogle()

      if (res.success) {
        // 检查是否正在重定向
        if ((res as any).isRedirecting) {
          // 重定向中，页面即将刷新，保持 loading 状态
          message.loading(t('auth.redirectingToGoogle'), 0)
          return
        }

        // 检查是否需要完善信息
        if ((res as any).needsProfile) {
          message.info(t('auth.completeProfileInfo'))
          navigate('/auth/complete-profile', { replace: true })
        } else {
          message.success(t('auth.loginSuccess'))
          navigate('/', { replace: true })
        }
      } else {
        // 使用 placeholder 显示错误
        setLoginError(t('auth.loginFailedPrefix') + ((res as any).error?.message || t('auth.loginFailed')))
        setLoading(false)
      }
    } catch (error) {
      setLoginError(t('auth.loginFailedPrefix') + t('auth.loginFailed'))
      setLoading(false)
    }
  }

  const handleResetPassword = async (values: { identifier: string }) => {
    // 检查是否距离上次发送不足1分钟
    const now = Date.now()
    const lastSendTime = getLastResetPasswordTime()

    if (lastSendTime !== null) {
      const timeSinceLastSend = now - lastSendTime
      const oneMinute = 60 * 1000 // 1分钟 = 60000毫秒

      if (timeSinceLastSend < oneMinute) {
        const remainingSeconds = Math.ceil((oneMinute - timeSinceLastSend) / 1000)
        setResetPasswordCooldown(remainingSeconds)
        return
      }
    }

    setResetPasswordLoading(true)
    try {
      const identifier = values.identifier.trim()

      // 如果禁用了邮箱和 Google 登录，只处理手机号重置
      if (appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin) {
        const result = await resetPasswordByPhone(identifier)
        if (result.success) {
          const sendTime = Date.now()
          saveLastResetPasswordTime(sendTime) // 保存发送时间到 localStorage
          message.success(t('auth.passwordResetSentToPhone'))
          setResetPasswordVisible(false)
          resetPasswordForm.resetFields()
        } else {
          message.error(result.error || t('auth.resetPasswordFailed'))
        }
        return
      }

      // 否则根据输入类型处理
      const type = identifyInputType(identifier)

      if (type === 'email') {
        // 邮箱重置：发送重置链接
        const result = await sendPasswordResetEmailFor(identifier)
        if (result.success) {
          const sendTime = Date.now()
          saveLastResetPasswordTime(sendTime) // 保存发送时间到 localStorage
          message.success(t('auth.resetEmailSent'))
          setResetPasswordVisible(false)
          resetPasswordForm.resetFields()
        } else {
          message.error(result.error?.message || t('auth.sendResetEmailFailed'))
        }
      } else if (type === 'phone') {
        // 手机号重置：生成临时密码并通过 whapi 发送
        const result = await resetPasswordByPhone(identifier)
        if (result.success) {
          const sendTime = Date.now()
          saveLastResetPasswordTime(sendTime) // 保存发送时间到 localStorage
          message.success(t('auth.passwordResetSentToPhone'))
          setResetPasswordVisible(false)
          resetPasswordForm.resetFields()
        } else {
          message.error(result.error || t('auth.resetPasswordFailed'))
        }
      } else {
        message.error(t('auth.invalidEmailOrPhone'))
      }
    } catch (error: any) {
      message.error(error.message || t('auth.resetPasswordFailed'))
    } finally {
      setResetPasswordLoading(false)
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

      <Card style={{
        width: '100%',
        maxWidth: 400,
        background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.9) 0%, rgba(45, 45, 45, 0.8) 100%)',
        border: '1px solid rgba(255, 215, 0, 0.2)',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 32px rgba(255, 215, 0, 0.1)',
        backdropFilter: 'blur(10px)',
        position: 'relative',
        zIndex: 1
      }}>
        {configLoading ? (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '300px',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <Spin
              indicator={<LoadingOutlined style={{ fontSize: 32, color: '#ffd700' }} spin />}
              size="large"
            />
            <Text style={{ color: '#c0c0c0' }}>{t('common.loading')}</Text>
          </div>
        ) : (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ textAlign: 'center', paddingTop: '20px' }}>
              {/* 应用 Logo */}
              {appConfig?.logoUrl && !logoError && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  background: 'transparent'
                }}>
                  <img
                    src={appConfig.logoUrl}
                    alt={appConfig?.appName || 'App Logo'}
                    onError={() => {
                      console.warn('[Login] Logo 加载失败:', appConfig.logoUrl)
                      setLogoError(true)
                    }}
                    style={{
                      width: 'auto',
                      height: '50px',
                      maxWidth: '100%',
                      objectFit: 'contain',
                      background: 'transparent',
                      mixBlendMode: 'normal'
                    }}
                  />
                </div>
              )}
              <Title level={2} style={{
                marginTop: 10,
                marginBottom: 8,
                background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: 700,
                letterSpacing: '2px'
              }}>
                {appConfig?.appName || 'Cigar Club'}
              </Title>
              <Text style={{ color: '#c0c0c0', fontSize: '16px' }}>
                {t('auth.welcomeBack')}
              </Text>
            </div>

            {/* 显示登录表单（即使禁用电邮登录，仍允许手机号登录） */}
            <Form
              name="login"
              onFinish={onFinish}
              autoComplete="off"
              size="large"
              style={{ padding: '0 20px' }}
            >
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: appConfig?.auth?.disableEmailLogin ? t('auth.phoneOnlyRequired') : t('auth.emailOrPhoneRequired') },
                  {
                    validator: (_, value) => {
                      if (!value) return Promise.resolve()

                      // 检查中文字符
                      if (/[\u4e00-\u9fa5]/.test(value)) {
                        return Promise.reject(new Error(t('auth.noChinese')))
                      }

                      const type = identifyInputType(value)

                      if (type === 'unknown') {
                        return Promise.reject(new Error(appConfig?.auth?.disableEmailLogin ? t('auth.phoneOnlyInvalid') : t('auth.invalidEmailOrPhone')))
                      }

                      // 如果禁用了电邮登录，不允许使用邮箱
                      if (appConfig?.auth?.disableEmailLogin && type === 'email') {
                        return Promise.reject(new Error(t('auth.phoneOnlyInvalid')))
                      }

                      // 邮箱验证：必须包含 @ 和 .
                      if (type === 'email') {
                        if (!isValidEmail(value)) {
                          return Promise.reject(new Error(t('auth.emailFormatInvalid')))
                        }
                      }

                      // 手机号额外验证标准化
                      if (type === 'phone') {
                        const normalized = normalizePhoneNumber(value)
                        if (!normalized) {
                          return Promise.reject(new Error(t('auth.phoneFormatInvalidLogin')))
                        }
                      }

                      return Promise.resolve()
                    }
                  }
                ]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: loginError ? '#ff4d4f' : '#ffd700' }} />}
                  placeholder={loginError || (appConfig?.auth?.disableEmailLogin ? t('auth.phonePlaceholder') : t('auth.emailOrPhonePlaceholder'))}
                  onInput={(e) => {
                    const input = e.currentTarget
                    // 清除错误状态
                    if (loginError) setLoginError('')

                    // 如果禁用了电邮登录，只允许输入数字
                    if (appConfig?.auth?.disableEmailLogin) {
                      input.value = input.value.replace(/\D/g, '')
                    } else {
                      // 禁止输入中文字符
                      input.value = input.value.replace(/[\u4e00-\u9fa5]/g, '')
                      // 如果不是邮箱（不含@），自动清理空格
                      if (!input.value.includes('@')) {
                        input.value = input.value.replace(/\s/g, '')
                      }
                    }
                  }}
                  onKeyPress={(e) => {
                    // 如果禁用了电邮登录，只允许输入数字
                    if (appConfig?.auth?.disableEmailLogin) {
                      const char = String.fromCharCode(e.which || e.keyCode)
                      if (!/[0-9]/.test(char)) {
                        e.preventDefault()
                      }
                    }
                  }}
                  onPaste={(e) => {
                    // 如果禁用了电邮登录，只允许粘贴数字
                    if (appConfig?.auth?.disableEmailLogin) {
                      e.preventDefault()
                      const paste = (e.clipboardData || (window as any).clipboardData).getData('text')
                      const numbersOnly = paste.replace(/\D/g, '')
                      const input = e.currentTarget as HTMLInputElement
                      const start = input.selectionStart || 0
                      const end = input.selectionEnd || 0
                      const currentValue = input.value
                      input.value = currentValue.substring(0, start) + numbersOnly + currentValue.substring(end)
                      input.setSelectionRange(start + numbersOnly.length, start + numbersOnly.length)
                    }
                  }}
                  onFocus={() => {
                    // 获得焦点时清除错误
                    if (loginError) setLoginError('')
                  }}
                  style={{
                    background: 'rgba(45, 45, 45, 0.8)',
                    border: loginError ? '1px solid #ff4d4f' : '1px solid #444444',
                    borderRadius: '8px',
                    color: '#f8f8f8'
                  }}
                  className={loginError ? 'login-error-shake' : ''}
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[{ required: true, message: t('auth.passwordRequired') }]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: loginError ? '#ff4d4f' : '#ffd700' }} />}
                  placeholder={t('auth.password')}
                  iconRender={(visible) =>
                    visible ? (
                      <EyeOutlined style={{ color: '#ffd700' }} />
                    ) : (
                      <EyeInvisibleOutlined style={{ color: '#ffd700' }} />
                    )
                  }
                  onInput={() => {
                    // 清除错误状态
                    if (loginError) setLoginError('')
                  }}
                  onFocus={() => {
                    // 获得焦点时清除错误
                    if (loginError) setLoginError('')
                  }}
                  style={{
                    background: 'rgba(45, 45, 45, 0.8)',
                    border: loginError ? '1px solid #ff4d4f' : '1px solid #444444',
                    borderRadius: '8px',
                    color: '#f8f8f8'
                  }}
                  className={loginError ? 'login-error-shake' : ''}
                />
              </Form.Item>

              <Form.Item style={{ textAlign: 'right' }}>
                <Button
                  type="link"
                  onClick={() => setResetPasswordVisible(true)}
                  style={{
                    padding: 0,
                    height: 'auto',
                    color: '#ffd700',
                    fontSize: '14px'
                  }}
                >
                  {t('auth.resetPassword')}
                </Button>
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  style={{
                    width: '100%',
                    height: '48px',
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#221c10',
                    fontSize: '16px',
                    fontWeight: 600,
                    boxShadow: '0 4px 20px rgba(255, 215, 0, 0.3)'
                  }}
                  className="login-button"
                >
                  {t('auth.login')}
                </Button>
              </Form.Item>
            </Form>

            {/* 如果 Google 登录未被禁用，显示 Google 登录按钮 */}
            {!appConfig?.auth?.disableGoogleLogin && (
              <div style={{ padding: '0 20px' }}>
                <Button
                  icon={<GoogleOutlined />}
                  onClick={onGoogle}
                  loading={loading}
                  style={{
                    width: '100%',
                    height: '48px',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#221c10',
                    fontSize: '16px',
                    fontWeight: 600,
                    boxShadow: '0 4px 20px rgba(255, 215, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  {t('auth.loginWithGoogle')}
                </Button>
              </div>
            )}


            <div style={{ textAlign: 'center', paddingBottom: '20px' }}>
              <Text style={{ color: '#999999' }}>
                {t('auth.noAccount')}{' '}
                <Button
                  type="link"
                  onClick={() => navigate('/register')}
                  style={{
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: 700,
                    padding: 0
                  }}
                >
                  {t('auth.registerNow')}
                </Button>
              </Text>
            </div>
          </Space>
        )}
      </Card>

      {/* 重置密码 Modal */}
      <Modal
        title={
          <span style={{
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 700
          }}>
            {t('auth.resetPassword')}
          </span>
        }
        open={resetPasswordVisible}
        onCancel={() => {
          setResetPasswordVisible(false)
          resetPasswordForm.resetFields()
        }}
        footer={null}
        width={400}
        centered
        styles={{
          content: {
            background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(45, 45, 45, 0.9) 100%)',
            border: '1px solid rgba(255, 215, 0, 0.2)',
            borderRadius: '16px',
            backdropFilter: 'blur(10px)'
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
            padding: '16px 24px'
          }
        }}
      >
        <Form
          form={resetPasswordForm}
          layout="vertical"
          onFinish={handleResetPassword}
          style={{ marginTop: 24 }}
        >
          {resetPasswordCooldown !== null && resetPasswordCooldown > 0 && (
            <div style={{
              marginBottom: 16,
              padding: '12px 16px',
              background: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.3)',
              borderRadius: '8px',
              color: '#ffc107',
              fontSize: '14px',
              textAlign: 'center'
            }}>
              {t('auth.cooldownMessage', { resetPasswordCooldown })}
            </div>
          )}
          <Form.Item
            name="identifier"
            label={<span style={{ color: '#c0c0c0' }}>
              {appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin
                ? t('auth.phone')
                : t('auth.emailOrPhoneLabel')}
            </span>}
            rules={[
              {
                required: true, message: appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin
                  ? t('auth.phoneOnlyRequired')
                  : t('auth.pleaseEnterEmailOrPhone')
              },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve()

                  // 如果禁用了邮箱和 Google 登录，只验证手机号
                  if (appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin) {
                    const normalized = normalizePhoneNumber(value)
                    if (!normalized) {
                      return Promise.reject(new Error(t('profile.phoneInvalidFormat')))
                    }
                    return Promise.resolve()
                  }

                  // 否则验证邮箱或手机号
                  const type = identifyInputType(value)
                  if (type === 'unknown') {
                    return Promise.reject(new Error(t('auth.invalidEmailOrPhone')))
                  }

                  if (type === 'email') {
                    if (!isValidEmail(value)) {
                      return Promise.reject(new Error(t('auth.emailFormatInvalid')))
                    }
                  }

                  if (type === 'phone') {
                    const normalized = normalizePhoneNumber(value)
                    if (!normalized) {
                      return Promise.reject(new Error(t('profile.phoneInvalidFormat')))
                    }
                  }

                  return Promise.resolve()
                }
              }
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#ffd700' }} />}
              placeholder={
                appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin
                  ? t('auth.phone')
                  : t('auth.emailOrPhonePlaceholder')
              }
              onInput={(e) => {
                const input = e.currentTarget
                // 如果禁用了邮箱和 Google 登录，只允许输入数字
                if (appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin) {
                  input.value = input.value.replace(/\D/g, '')
                } else {
                  // 如果不是邮箱（不含@），自动清理空格
                  if (!input.value.includes('@')) {
                    input.value = input.value.replace(/\s/g, '')
                  }
                }
              }}
              onKeyPress={(e) => {
                // 如果禁用了邮箱和 Google 登录，只允许输入数字
                if (appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin) {
                  const char = String.fromCharCode(e.which || e.keyCode)
                  if (!/[0-9]/.test(char)) {
                    e.preventDefault()
                  }
                }
              }}
              onPaste={(e) => {
                // 如果禁用了邮箱和 Google 登录，只允许粘贴数字
                if (appConfig?.auth?.disableEmailLogin && appConfig?.auth?.disableGoogleLogin) {
                  e.preventDefault()
                  const paste = (e.clipboardData || (window as any).clipboardData).getData('text')
                  const numbersOnly = paste.replace(/\D/g, '')
                  const input = e.currentTarget as HTMLInputElement
                  const start = input.selectionStart || 0
                  const end = input.selectionEnd || 0
                  const currentValue = input.value
                  input.value = currentValue.substring(0, start) + numbersOnly + currentValue.substring(end)
                  input.setSelectionRange(start + numbersOnly.length, start + numbersOnly.length)
                }
              }}
              style={{
                background: 'rgba(45, 45, 45, 0.8)',
                border: '1px solid #444444',
                borderRadius: '8px',
                color: '#f8f8f8'
              }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  setResetPasswordVisible(false)
                  resetPasswordForm.resetFields()
                }}
                style={{
                  color: '#c0c0c0',
                  borderColor: '#444444'
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={resetPasswordLoading}
                disabled={resetPasswordCooldown !== null && resetPasswordCooldown > 0}
                style={{
                  background: resetPasswordCooldown !== null && resetPasswordCooldown > 0
                    ? 'rgba(255, 255, 255, 0.1)'
                    : 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                  borderRadius: '8px',
                  color: resetPasswordCooldown !== null && resetPasswordCooldown > 0
                    ? '#999999'
                    : '#221c10',
                  fontWeight: 600,
                  cursor: resetPasswordCooldown !== null && resetPasswordCooldown > 0
                    ? 'not-allowed'
                    : 'pointer'
                }}
              >
                {resetPasswordCooldown !== null && resetPasswordCooldown > 0
                  ? t('auth.waitSecondsButton', { resetPasswordCooldown })
                  : t('auth.sendReset')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  )
}

export default Login
