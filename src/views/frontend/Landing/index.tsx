import React, { useEffect, useState } from 'react'
import { Button, Typography, Space, App, Modal, Form, Input, Divider } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { UserOutlined, LockOutlined, GoogleOutlined } from '@ant-design/icons'
import { getAuthenticatedLandingPath, loginWithEmailOrPhone, registerUser, loginWithGoogle } from '../../../services/firebase/auth'
import { getAppConfig } from '../../../services/firebase/appConfig'
import type { AppConfig } from '../../../types'
import { normalizePhoneNumber } from '../../../utils/phoneNormalization'
import ResetPasswordModal from '../../../components/common/ResetPasswordModal'
import RegisterForm from '../../../components/auth/RegisterForm'
import GuestLoungePage from './GuestLoungePage'
import { guestPageConfig, guestMetadata } from '../../../config/guestPage'

const { Text } = Typography

interface LandingProps {
  loginOnly?: boolean
}

const Landing: React.FC<LandingProps> = ({ loginOnly = false }) => {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const openRegisterFromUrl = new URLSearchParams(window.location.search).get('open') === 'register'
  const openLoginFromUrl = new URLSearchParams(window.location.search).get('open') === 'login'
  const [authModalVisible, setAuthModalVisible] = useState(loginOnly || openRegisterFromUrl || openLoginFromUrl)
  const [authMode, setAuthMode] = useState<'login' | 'register'>(openRegisterFromUrl ? 'register' : 'login')
  const [authLoading, setAuthLoading] = useState(false)
  const [resetPasswordVisible, setResetPasswordVisible] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [loginForm] = Form.useForm()
  const [registerForm] = Form.useForm()
  const [loginError, setLoginError] = useState<string>('')
  const publicProfile = guestPageConfig(appConfig?.guestPage)
  const WHATSAPP_USER_ID = publicProfile.phone
  useEffect(() => {
    if (loginOnly) {
      let robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null
      if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots) }
      robots.content = 'noindex,nofollow'
      return
    }
    const metadata = guestMetadata(publicProfile)
    document.title = metadata.title
    document.documentElement.lang = i18n.language.startsWith('zh') ? 'zh-CN' : 'en'
    const setMeta = (key: string, content: string, attr = 'name') => {
      let node = document.head.querySelector('meta[' + attr + '="' + key + '"]') as HTMLMetaElement | null
      if (!node) { node = document.createElement('meta'); node.setAttribute(attr, key); document.head.appendChild(node) }
      node.content = content
    }
    setMeta('description', metadata.description)
    setMeta('og:title', metadata.title, 'property')
    setMeta('og:description', metadata.description, 'property')
    setMeta('og:url', 'https://macanudosocials.com/', 'property')
    setMeta('robots', window.location.hostname === 'macanudosocials.com' ? 'index,follow' : 'noindex,nofollow')
    let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = 'https://macanudosocials.com/'
    const schema = document.createElement('script')
    schema.type = 'application/ld+json'; schema.id = 'guest-local-business'
    schema.textContent = JSON.stringify(metadata.schema).replace(/</g, '\\u003c')
    document.getElementById(schema.id)?.remove(); document.head.appendChild(schema)
    const membership = publicProfile.membershipVersions?.slice().sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0]
    const faq = document.createElement('script')
    faq.type = 'application/ld+json'; faq.id = 'guest-faq'
    faq.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: 'What is the annual membership fee at Macanudo Socials?',
          acceptedAnswer: { '@type': 'Answer', text: `Annual membership at Macanudo Socials Kota Kinabalu is RM ${membership?.annualPrice ?? 299}. Members receive RM ${membership?.credit ?? 100} lounge credit and ${membership?.cigarsPerYear ?? 25} cigars per year. The first visit is complimentary.` } },
        { '@type': 'Question', name: 'What are the opening hours of Macanudo Socials in Kota Kinabalu?',
          acceptedAnswer: { '@type': 'Answer', text: `Macanudo Socials is open daily from ${publicProfile.opensAt} to ${publicProfile.closesAt}. Located at Block J, Unit 56, Ground Floor, Off Jalan Coastal, 88100 Kota Kinabalu, Sabah, Malaysia.` } },
        { '@type': 'Question', name: 'Where is Macanudo Socials located in Kota Kinabalu?',
          acceptedAnswer: { '@type': 'Answer', text: 'Macanudo Socials is located at Block J, Unit 56, Ground Floor, Off Jalan Coastal, 88100 Kota Kinabalu, Sabah, Malaysia. Contact: +60162773800.' } },
        { '@type': 'Question', name: 'Can non-smokers visit Macanudo Socials?',
          acceptedAnswer: { '@type': 'Answer', text: 'Yes. Macanudo Socials membership includes a non-smoker companion benefit. Members may bring non-smoking guests to enjoy the lounge ambience and beverages.' } },
      ],
    }).replace(/</g, '\\u003c')
    document.getElementById(faq.id)?.remove(); document.head.appendChild(faq)
    return () => { schema.remove(); faq.remove() }
  }, [appConfig?.guestPage, loginOnly, i18n.language])


  useEffect(() => {
    if (!openLoginFromUrl) return
    const phone = normalizePhoneNumber(new URLSearchParams(window.location.search).get('phone') || '')
    if (phone) loginForm.setFieldsValue({ email: phone })
  }, [loginForm, openLoginFromUrl])

  useEffect(() => {
    if (!loginOnly || openRegisterFromUrl) return
    setAuthMode('login')
    setAuthModalVisible(true)
  }, [loginOnly, openRegisterFromUrl])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('open') !== 'register') return

    const referralCode = params.get('ref')?.trim().toUpperCase()
    if (!referralCode) {
      setAuthMode('register')
      setAuthModalVisible(true)
      return
    }

    const command = encodeURIComponent(`/register ${referralCode}`)
    const appUrl = `whatsapp://send?phone=${WHATSAPP_USER_ID}&text=${command}`
    const webUrl = `https://api.whatsapp.com/send/?phone=${WHATSAPP_USER_ID}&text=${command}`
    let appOpened = false
    const markAppOpened = () => {
      appOpened = true
      window.clearTimeout(fallbackTimer)
    }
    const fallbackTimer = window.setTimeout(() => {
      if (!appOpened) window.location.replace(webUrl)
    }, 1200)

    document.addEventListener('visibilitychange', markAppOpened, { once: true })
    window.location.href = appUrl

    return () => {
      window.clearTimeout(fallbackTimer)
      document.removeEventListener('visibilitychange', markAppOpened)
    }
  }, [])

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getAppConfig()
        if (config) setAppConfig(config)
      } catch (error) {
        console.error('Failed to load landing data:', error)
      }
    }
    loadConfig()
  }, [])

  const handleLogin = async (values: any) => {
    setAuthLoading(true)
    setLoginError('')
    try {
      const result = await loginWithEmailOrPhone(values.email, values.password)
      if (result.success) {
        message.success(t('auth.loginSuccess'))
        setAuthModalVisible(false)
        navigate(await getAuthenticatedLandingPath(result.user?.uid, (result as any).firestoreUserId), { replace: true })
      } else {
        const errMsg = (result as any).error?.message || t('auth.loginFailed')
        setLoginError(errMsg)
        message.error(errMsg)
      }
    } catch (error) {
      setLoginError(t('auth.loginFailed'))
      message.error(t('auth.loginFailed'))
    } finally {
      setAuthLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setAuthLoading(true)
    try {
      const res = await loginWithGoogle()
      if (res.success) {
        if ((res as any).isRedirecting) {
          message.loading('Redirecting to Google...', 0)
          return
        }
        message.success(t('auth.loginSuccess'))
        setAuthModalVisible(false)
        navigate((res as any).needsProfile ? '/auth/complete-profile' : await getAuthenticatedLandingPath(res.user?.uid, (res as any).firestoreUserId), { replace: true })
      } else {
        message.error((res as any).error?.message || t('auth.loginFailed'))
      }
    } catch (error) {
      message.error(t('auth.loginFailed'))
    } finally {
      if (!(authLoading && (window as any).isRedirecting)) {
        setAuthLoading(false)
      }
    }
  }

  const handleRegister = async (values: any) => {
    setAuthLoading(true)
    try {
      const result = await registerUser(
        values.email,
        values.password,
        values.displayName,
        values.phone,
        values.referralCode
      )
      if (result.success) {
        message.success(t('auth.registerSuccess'))

        // 等待 Firestore 写入完成，然后更新本地状态以触发 App.tsx 中 user 路由切换
        const timer = setTimeout(() => {
          setAuthModalVisible(false)
          // 这里的 navigate('/') 会在 App.tsx 检测到 user 非空后渲染 Home 页面
          navigate('/')
        }, 1500)

        return () => clearTimeout(timer)
      } else {
        message.error((result as any).error?.message || t('auth.registerFailed'))
      }
    } catch (error) {
      message.error(t('auth.registerFailedRetry'))
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <div className={`landing-page${loginOnly ? ' login-only' : ''}`}>
      {!loginOnly && <GuestLoungePage config={publicProfile} logoUrl={appConfig?.logoUrl}
        onLogin={() => { setAuthMode('login'); setAuthModalVisible(true); }}
        onRegister={() => { setAuthMode('register'); setAuthModalVisible(true); }} />}
      {/* Auth Modal */}
      <Modal
        className="guest-auth-modal"
        open={authModalVisible}
        onCancel={() => {
          if (loginOnly) return
          setAuthModalVisible(false)
          setLoginError('')
        }}
        closable={!loginOnly}
        maskClosable={!loginOnly}
        keyboard={!loginOnly}
        footer={null}
        width={372}
        centered
        styles={{
          mask: {
            backdropFilter: 'blur(10px)',
            background: 'rgba(0, 0, 0, 0.4)'
          },
          content: {
            maxWidth: '372px',
            background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.98) 0%, rgba(45, 45, 45, 0.95) 100%)',
            border: '1px solid rgba(197, 165, 90, 0.4)',
            borderRadius: '20px',
            backdropFilter: 'blur(30px)',
            padding: 0,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }
        }}
      >
        <div className="ant-card-body" style={{ padding: '14px 0' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ textAlign: 'center', paddingTop: '4px' }}>
              {appConfig?.logoUrl && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px' }}>
                  <img
                    src={appConfig.logoUrl}
                    alt="Logo"
                    style={{
                      width: 'auto',
                      height: '72px',
                      maxWidth: '100%',
                      objectFit: 'contain'
                    }}
                  />
                </div>
              )}
              <Text style={{ color: '#c0c0c0', fontSize: '16px' }}>
                {authMode === 'login'
                  ? t('auth.welcomeBack')
                  : t('auth.createAccountSubtitle', { defaultValue: `Create an account` })
                }
              </Text>
            </div>

            {authMode === 'login' ? (
              <Form className="auth-form" form={loginForm} onFinish={handleLogin} layout="vertical" size="large" style={{ padding: '0 30px' }}>
                <Form.Item name="email" rules={[{ required: true, message: loginError || 'Please input your email or phone!' }]}>
                  <Input
                    prefix={<UserOutlined style={{ color: loginError ? '#ff4d4f' : '#ffd700' }} />}
                    placeholder={loginError || "Email or Phone"}
                    className={`auth-input ${loginError ? 'error-shake' : ''}`}
                    onFocus={() => setLoginError('')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: loginError ? '1px solid #ff4d4f' : '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: 'Please input your password!' }]}>
                  <Input.Password
                    prefix={<LockOutlined style={{ color: loginError ? '#ff4d4f' : '#ffd700' }} />}
                    placeholder="Password"
                    className={`auth-input ${loginError ? 'error-shake' : ''}`}
                    onFocus={() => setLoginError('')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: loginError ? '1px solid #ff4d4f' : '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>

                <div style={{ textAlign: 'right', marginBottom: '24px' }}>
                  <Button
                    type="link"
                    htmlType="button"
                    onClick={() => setResetPasswordVisible(true)}
                    style={{ height: 'auto', padding: 0, color: '#ffd700', fontSize: '14px' }}
                  >
                    {t('auth.resetPassword')}
                  </Button>
                </div>

                <Button
                  type="primary"
                  htmlType="submit"
                  loading={authLoading}
                  style={{
                    width: '100%',
                    height: '48px',
                    background: 'var(--cigar-gradient-gold)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#221c10',
                    fontSize: '16px',
                    fontWeight: 600,
                    boxShadow: '0 4px 20px rgba(255, 215, 0, 0.3)'
                  }}
                >
                  {t('auth.login')}
                </Button>

                {!appConfig?.auth?.disableGoogleLogin && (
                  <>
                    <Divider style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)', margin: '24px 0' }}>OR</Divider>
                    <Button
                      icon={<GoogleOutlined />}
                      onClick={handleGoogleLogin}
                      loading={authLoading}
                      style={{
                        width: '100%',
                        height: '48px',
                        borderRadius: '8px',
                        background: 'white',
                        color: '#221c10',
                        border: 'none',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      {t('auth.loginWithGoogle')}
                    </Button>
                  </>
                )}

                <div style={{ textAlign: 'center', marginTop: '24px', paddingBottom: '10px' }}>
                  <Text style={{ color: '#999999', fontSize: '14px' }}>
                    {t('auth.noAccount')}{' '}
                    <a
                      onClick={() => setAuthMode('register')}
                      style={{
                        background: 'var(--cigar-gradient-gold)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {t('auth.registerNow')}
                    </a>
                  </Text>
                </div>
              </Form>
            ) : (
              <RegisterForm form={registerForm} onFinish={handleRegister} loading={authLoading} compact onSwitchToLogin={() => setAuthMode('login')} />
            )}
          </Space>
        </div>
      </Modal>

      <ResetPasswordModal
        open={resetPasswordVisible}
        onClose={() => setResetPasswordVisible(false)}
        appConfig={appConfig}
      />

      <style>{`
        .guest-auth-modal .auth-input {
          background: rgba(255, 255, 255, 0.05) !important;
          border: 1px solid rgba(197, 165, 90, 0.2) !important;
          border-radius: 8px !important;
          color: #fff !important;
        }
        .guest-auth-modal .auth-input:focus {
          border-color: var(--gold) !important;
          box-shadow: 0 0 0 2px rgba(197, 165, 90, 0.1) !important;
        }
        .guest-auth-modal .auth-input input {
          background: transparent !important;
          color: #fff !important;
        }
        .guest-auth-modal .ant-modal-close {
          color: var(--gold) !important;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .guest-auth-modal .error-shake {
          animation: shake 0.5s;
          border-color: #ff4d4f !important;
        }
      `}</style>
    </div>
  )
}

export default Landing
