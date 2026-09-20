import React, { useEffect, useState } from 'react'
import { Button, Row, Col, Typography, Space, message, Modal, Form, Input, Divider } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRightOutlined,
  MenuOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  ThunderboltOutlined,
  CrownOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  UserOutlined,
  StarFilled,
  LockOutlined,
  MailOutlined,
  GoogleOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  GiftOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { getBrands, getUpcomingEvents } from '../../../services/firebase/firestore'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { loginWithEmailOrPhone, registerUser, loginWithGoogle } from '../../../services/firebase/auth'
import { getAppConfig } from '../../../services/firebase/appConfig'
import type { Brand, Event as CigarEvent, AppConfig } from '../../../types'
import { identifyInputType, normalizePhoneNumber, isValidEmail } from '../../../utils/phoneNormalization'

const { Title, Paragraph, Text } = Typography

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }

    setPrefersReducedMotion(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}

const Landing: React.FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const prefersReducedMotion = usePrefersReducedMotion()
  const { data: brands = [] } = useFirestoreQuery(
    async () => {
      const data = await getBrands()
      return data.filter(b => b.status === 'active').slice(0, 10)
    }
  )
  const { data: events = [] } = useFirestoreQuery(
    async () => {
      const data = await getUpcomingEvents()
      return data.slice(0, 3)
    }
  )
  const [scrolled, setScrolled] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 992)
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false)
  const [salonModalVisible, setSalonModalVisible] = useState(false)
  const [authModalVisible, setAuthModalVisible] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [loginForm] = Form.useForm()
  const [registerForm] = Form.useForm()
  const [loginError, setLoginError] = useState<string>('')

  useEffect(() => {
    if (prefersReducedMotion || isMobile) return

    const timer = setTimeout(() => {
      setSalonModalVisible(true)
    }, 1500)
    return () => clearTimeout(timer)
  }, [isMobile, prefersReducedMotion])

  useEffect(() => {
    const handleScroll = () => {
      const offset = window.scrollY || document.documentElement.scrollTop
      setScrolled(offset > 10)
    }
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
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
        navigate('/')
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
        navigate('/')
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
    <div className={`landing-page${prefersReducedMotion ? ' motion-reduced' : ''}`} style={{
      backgroundColor: '#0A0A0A',
      color: '#E5E5E5',
      fontFamily: "'Manrope', sans-serif",
      minHeight: '100vh',
      overflowX: 'hidden'
    }}>
      {/* Custom Styles for Landing Page */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Manrope:wght@300;400;500;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap');

        :root {
          --gold: #C5A55A;
          --gold-hover: #D4AF37;
          --text-primary: #E5E5E5;
          --text-secondary: #A1A1AA;
          --bg-card: #1A1A1A;
          --border: #2F2F2F;
        }

        .font-serif { font-family: 'Playfair Display', serif; }
        .font-italic-serif { font-family: 'Cormorant Garamond', serif; font-style: italic; }

        .gold-text {
          background: linear-gradient(135deg, #C5A55A 0%, #F4E4BC 50%, #C5A55A 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .noise-overlay::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 1;
        }

        .section-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(197,165,90,0.3), transparent);
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .animate-fade-in-up {
          animation: fadeInUp 0.7s ease-out forwards;
        }

        .hero-split-left {
          filter: grayscale(100%) brightness(0.6);
          transition: filter 0.5s ease;
        }
        .hero-split-left:hover {
          filter: grayscale(30%) brightness(0.8);
        }

        .card-glow:hover {
          box-shadow: 0 0 40px -10px rgba(197, 165, 90, 0.15);
          border-color: rgba(197, 165, 90, 0.4) !important;
        }

        .marquee {
          display: flex;
          gap: 4rem;
          animation: marquee 40s linear infinite;
          width: max-content;
        }

        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .nav-link {
          color: var(--text-secondary);
          transition: color 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: 14px;
        }
        .nav-link:hover {
          color: var(--gold);
        }

        .mobile-menu-icon-button {
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 12px;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--gold);
          cursor: pointer;
        }

        .mobile-menu-icon-button:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 4px;
        }

        .motion-reduced .animate-fade-in-up,
        .motion-reduced .marquee,
        .motion-reduced .error-shake {
          animation: none !important;
        }

        .motion-reduced .animate-fade-in-up {
          opacity: 1;
          transform: none;
        }

        .motion-reduced .hero-split-left,
        .motion-reduced .btn-gold,
        .motion-reduced .nav-link,
        .motion-reduced .card-glow,
        .motion-reduced .mobile-menu-icon-button {
          transition: none !important;
        }

        .navbar-container {
          padding: 0 24px;
        }
        @media (min-width: 768px) {
          .navbar-container { padding: 0 48px; }
        }
        @media (min-width: 1024px) {
          .navbar-container { padding: 0 96px; }
        }

        .btn-gold {
          background-color: var(--gold);
          color: black;
          border: none;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          border-radius: 2px;
          transition: all 0.3s ease;
        }
        .btn-gold:hover {
          background-color: var(--gold-hover);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(197, 165, 90, 0.3);
        }

        .btn-outline-gold {
          border: 1px solid var(--gold);
          color: var(--gold);
          background: transparent;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          border-radius: 2px;
        }
        .btn-outline-gold:hover {
          background-color: var(--gold);
          color: black;
        }
        .btn-gold {
          background-color: var(--gold);
          color: black;
        }
      `}</style>

      {/* Navbar */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        transition: 'all 0.3s ease',
        backgroundColor: scrolled ? '#0A0A0A' : 'transparent',
        borderBottom: scrolled ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        height: '80px',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div className="navbar-container" style={{ maxWidth: '1280px', margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => navigate('/')}>
            <span className="font-serif" style={{ fontSize: '20px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              <span style={{ color: 'var(--gold)' }}>Gentlemen</span>
              <span style={{ color: '#E5E5E5' }}>Club</span>
            </span>
          </div>

          {!isMobile && (
            <Space size={40}>
              <a href="#home" className="nav-link">{t('navigation.home')}</a>
              <a href="#problem-solution" className="nav-link">{t('navigation.about')}</a>
              <a href="#offerings" className="nav-link">{t('navigation.collections')}</a>
              <a href="#trust" className="nav-link">{t('navigation.salonEvents')}</a>
            </Space>
          )}

          <Space>
            <a
              href="https://api.whatsapp.com/send?phone=601157288278&text=Name%3A%0AContact%3A%0ABudget%3A%0APreferred%20date%3A%0A/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-gold"
              style={{
                display: isMobile ? 'none' : 'inline-block',
                textDecoration: 'none',
                padding: '8px 24px',
                fontSize: '12px'
              }}
            >
              Contact Us
            </a>
            {!isMobile && (
              <Button
                className="btn-gold"
                onClick={() => {
                  setAuthMode('login')
                  setAuthModalVisible(true)
                }}
                style={{ height: '40px', fontSize: '12px' }}
              >
                Become a Member
              </Button>
            )}
            {isMobile && (
              <button
                type="button"
                className="mobile-menu-icon-button"
                aria-label="Open navigation menu"
                aria-expanded={mobileMenuVisible}
                onClick={() => setMobileMenuVisible(true)}
              >
                <MenuOutlined style={{ fontSize: '24px' }} aria-hidden="true" />
              </button>
            )}
          </Space>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home" style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {/* Split Left */}
          <div className="hero-split-left" style={{
            position: 'relative',
            width: isMobile ? '100%' : '40%',
            backgroundImage: 'url("https://images.pexels.com/photos/5714455/pexels-photo-5714455.jpeg")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            height: '100%'
          }}>
            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
            {!isMobile && (
              <div style={{ position: 'absolute', bottom: '48px', left: '48px', zIndex: 10 }}>
                <p style={{ color: '#52525B', fontSize: '12px', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '8px' }}>The Generic Exchange</p>
                <p style={{ color: '#52525B', fontSize: '12px', letterSpacing: '0.1em' }}>Forgettable. Transferable.</p>
              </div>
            )}
          </div>
          {/* Split Right */}
          {!isMobile && (
            <div style={{
              position: 'relative',
              width: '60%',
              backgroundImage: 'url("https://images.pexels.com/photos/7299589/pexels-photo-7299589.jpeg")',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              height: '100%'
            }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to left, rgba(10,10,10,0.4), rgba(10,10,10,0.7))' }} />
              <div style={{ position: 'absolute', bottom: '48px', right: '48px', zIndex: 10, textAlign: 'right' }}>
                <p style={{ color: 'var(--gold)', fontSize: '12px', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '8px' }}>The Curated Connection</p>
                <p style={{ color: 'rgba(197, 165, 90, 0.7)', fontSize: '12px', letterSpacing: '0.1em' }}>Memorable. Transformational.</p>
              </div>
            </div>
          )}
        </div>

        {/* Content Overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to b, rgba(10,10,10,0.3), transparent, rgba(10,10,10,1))',
          zIndex: 15,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          textAlign: 'center'
        }}>
          <p className="animate-fade-in-up" style={{ color: 'rgba(197, 165, 90, 0.6)', fontSize: '12px', letterSpacing: '0.4em', textTransform: 'uppercase', marginTop: '64px' }}>#BeyondBusiness</p>
          <h1 className="font-serif animate-fade-in-up" style={{
            fontSize: isMobile ? '36px' : '64px',
            fontWeight: 700,
            lineHeight: 1.2,
            maxWidth: '1000px',
            marginBottom: '24px',
            animationDelay: '0.1s'
          }}>
            Farewell to Generic Gifting.<br />
            <span className="gold-text">Ignite Deep Connections</span><br />
            Through the Art of Cigars.
          </h1>
          <p className="font-italic-serif animate-fade-in-up" style={{
            fontSize: isMobile ? '18px' : '24px',
            color: 'var(--text-secondary)',
            maxWidth: '700px',
            marginBottom: '40px',
            animationDelay: '0.2s'
          }}>
            Does your thoughtfulness get lost in the shuffle of forgettable gifts?
          </p>
          <Button
            className="btn-gold animate-fade-in-up"
            style={{
              minHeight: isMobile ? '52px' : '60px',
              height: 'auto',
              width: isMobile ? '100%' : 'auto',
              maxWidth: isMobile ? 'min(100%, 312px)' : 'none',
              padding: isMobile ? '12px 18px' : '0 48px',
              fontSize: isMobile ? '14px' : '16px',
              lineHeight: 1.25,
              whiteSpace: 'normal',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              animationDelay: '0.3s'
            }}
            onClick={() => {
              window.open('https://api.whatsapp.com/send?phone=601157288278&text=Name%3A%0AContact%3A%0ABudget%3A%0APreferred%20date%3A%0A/', '_blank')
            }}
          >
            Explore Your Exclusive Taste <ArrowRightOutlined />
          </Button>
        </div>
      </section>

      {/* Brands Section (Marquee) */}
      <div style={{ backgroundColor: '#111', padding: '60px 0', borderTop: '1px solid rgba(197, 165, 90, 0.2)', borderBottom: '1px solid rgba(197, 165, 90, 0.2)' }}>
        <div className="marquee">
          {[...brands, ...brands, ...brands].map((brand, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', opacity: 0.6 }}>
              {brand.logo ? (
                <img src={brand.logo} alt={brand.name} style={{ height: '32px', filter: 'grayscale(100%) brightness(2)' }} />
              ) : (
                <CrownOutlined style={{ fontSize: '24px', color: 'var(--gold)' }} />
              )}
              <span className="font-serif" style={{ fontSize: '18px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>{brand.name}</span>
            </div>
          ))}
          {/* Fallback if no brands */}
          {brands.length === 0 && Array(10).fill(0).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', opacity: 0.6 }}>
              <CrownOutlined style={{ fontSize: '24px', color: 'var(--gold)' }} />
              <span className="font-serif" style={{ fontSize: '18px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>EXQUISITE CIGAR</span>
            </div>
          ))}
        </div>
      </div>

      {/* Problem & Solution Section */}
      <section id="problem-solution" className="noise-overlay" style={{ position: 'relative', padding: isMobile ? '80px 24px' : '120px 0' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: 'var(--gold)', fontSize: '12px', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '16px' }}>The Problem & The Solution</p>
          <h2 className="font-serif" style={{ fontSize: isMobile ? '32px' : '48px', marginBottom: '24px' }}>
            Why Ordinary Gifts <span style={{ color: '#A0522D', fontStyle: 'italic' }}>Fall Short</span>
          </h2>
          <p className="font-italic-serif" style={{ fontSize: '20px', color: 'var(--text-secondary)', maxWidth: '800px', margin: '0 auto 64px' }}>
            Tired of sending the same predictable gifts that fail to leave a lasting impression?
          </p>

          <Row gutter={[24, 24]}>
            {[
              { title: 'The Shelf-Life Issue', desc: 'Generic hampers are forgotten in 48 hours. Your thoughtful gesture becomes just another item on a shelf.', stat: '48h', statUnit: 'Average memory span' },
              { title: 'The Connection Gap', desc: "Standard gifts don't start conversations. They arrive, get acknowledged with a polite thank-you, and the relationship stays flat.", stat: '0', statUnit: 'Conversations started' },
              { title: 'The Social Catalyst', desc: "A cigar ceremony creates a 1-hour bonding window. It's not just a gift—it's an invitation to slow down and connect.", stat: '60min', statUnit: 'Of genuine connection' }
            ].map((card, i) => (
              <Col key={i} xs={24} md={8}>
                <div className="card-glow" style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  padding: '48px 32px',
                  height: '100%',
                  textAlign: 'left',
                  transition: 'all 0.4s ease'
                }}>
                  <div style={{ marginBottom: '24px' }}>
                    <span style={{ fontSize: '48px', fontWeight: 700, color: i === 2 ? 'var(--gold)' : '#2F2F2F', display: 'block' }}>{card.stat}</span>
                    <span style={{ color: '#52525B', fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{card.statUnit}</span>
                  </div>
                  <h3 className="font-serif" style={{ fontSize: '22px', marginBottom: '16px' }}>{card.title}</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>{card.desc}</p>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      </section>

      {/* Offerings Section */}
      <section id="offerings" style={{ padding: isMobile ? '80px 24px' : '120px 0', backgroundColor: '#000' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '80px' }}>
            <p style={{ color: 'var(--gold)', fontSize: '12px', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '16px' }}>Curated Collections</p>
            <h2 className="font-serif" style={{ fontSize: isMobile ? '32px' : '48px', marginBottom: '24px' }}>
              Your Gateway to <span className="gold-text">Distinction</span>
            </h2>
            <p className="font-italic-serif" style={{ fontSize: '20px', color: 'var(--text-secondary)', maxWidth: '800px', margin: '0 auto' }}>
              Each collection is crafted to transform a simple gesture into an unforgettable experience
            </p>
          </div>

          <Row gutter={[32, 32]}>
            {[
              {
                tag: 'Signature Collection',
                title: 'Elite Social Key Gift Box',
                desc: "More than a gift—it's a key to unlock high-end social circles. Featuring hand-selected premium cigars and private sommelier service.",
                img: 'https://images.unsplash.com/photo-1760804876166-aae5861ec7c1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2OTV8MHwxfHNlYXJjaHwxfHxwcmVtaXVtJTIwY2lnYXIlMjBnaWZ0JTIwYm94JTIwcGFja2FnaW5nJTIwYmxhY2slMjBnb2xkfGVufDB8fHx8MTc3MTc4OTQ0N3ww&ixlib=rb-4.1.0&q=85'
              },
              {
                tag: 'Discovery Series',
                title: 'Entry-Level Cigar Experience',
                desc: "A thoughtfully curated selection to begin your cigar journey—complete with brand stories and a beginner's tasting guide.",
                img: 'https://images.pexels.com/photos/1637114/pexels-photo-1637114.jpeg'
              },
              {
                tag: 'Her Collection',
                title: 'Elegant Taste Gifting for Women',
                desc: "Break tradition with a distinctive cultural symbol that showcases exceptional taste and discernment. Mild-aroma introductory cigars.",
                img: 'https://images.pexels.com/photos/7299589/pexels-photo-7299589.jpeg'
              }
            ].map((item, i) => (
              <Col key={i} xs={24} md={8}>
                <div className="card-glow" style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  transition: 'all 0.4s ease'
                }}>
                  <div style={{ height: '240px', overflow: 'hidden', position: 'relative' }}>
                    <img src={item.img} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', top: '16px', left: '16px', backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid rgba(197,165,90,0.3)', padding: '4px 12px', fontSize: '10px', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {item.tag}
                    </div>
                  </div>
                  <div style={{ padding: '32px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 className="font-serif" style={{ fontSize: '20px', marginBottom: '16px' }}>{item.title}</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px', flex: 1 }}>{item.desc}</p>
                    <Button
                      className="btn-outline-gold"
                      style={{ height: '48px', width: '100%' }}
                      onClick={() => {
                        window.open('https://api.whatsapp.com/send?phone=601157288278&text=Name%3A%0AContact%3A%0ABudget%3A%0APreferred%20date%3A%0A/', '_blank')
                      }}
                    >
                      Customize Your Key <ArrowRightOutlined />
                    </Button>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      </section>

      {/* Experience & Community (Salon) */}
      <section id="trust" className="noise-overlay" style={{ position: 'relative', padding: isMobile ? '80px 24px' : '120px 0' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <Row gutter={[48, 48]} align="middle">
            <Col xs={24} lg={12}>
              <div style={{ position: 'relative', height: isMobile ? '300px' : '500px', overflow: 'hidden' }}>
                <img src="https://images.pexels.com/photos/25747045/pexels-photo-25747045.jpeg" alt="Salon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: '24px', left: '24px', backgroundColor: 'rgba(0,0,0,0.8)', padding: '24px', border: '1px solid var(--gold)' }}>
                  <p style={{ color: 'var(--gold)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '8px' }}>Monthly Salon</p>
                  <p style={{ fontSize: '24px', fontWeight: 700 }}>RM 150</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Includes food, drinks & cigars</p>
                </div>
              </div>
            </Col>
            <Col xs={24} lg={12}>
              <p style={{ color: 'var(--gold)', fontSize: '12px', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '16px' }}>Experience & Community</p>
              <h2 className="font-serif" style={{ fontSize: isMobile ? '32px' : '44px', marginBottom: '24px' }}>
                Monthly Taste <span style={{ color: '#A0522D', fontStyle: 'italic' }}>Salon</span>
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: 1.8, marginBottom: '32px' }}>
                Join our exclusive monthly gathering where a professional cigar sommelier guides you through the art of cigar appreciation. Network with fellow connoisseurs, share stories of success, and master the art of social connection — all in an atmosphere of refined elegance.
              </p>
              <Row gutter={[16, 16]} style={{ marginBottom: '40px' }}>
                {['Premium Pairings', 'Curated Guests', 'Monthly Event'].map((f, i) => (
                  <Col key={i} span={8}>
                    <div style={{ backgroundColor: '#1A1A1A', border: '1px solid #2F2F2F', padding: '12px', textAlign: 'center' }}>
                      <Text style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{f}</Text>
                    </div>
                  </Col>
                ))}
              </Row>
              <Button
                className="btn-gold"
                style={{ height: '60px', padding: '0 48px', fontSize: '16px', fontWeight: 700 }}
                onClick={() => {
                  setAuthMode('register')
                  setAuthModalVisible(true)
                }}
              >
                Join the Club Now
              </Button>
            </Col>
          </Row>

          <div style={{ marginTop: '100px', borderTop: '1px solid #2F2F2F', borderBottom: '1px solid #2F2F2F', padding: '64px 0' }}>
            <Row gutter={[32, 32]}>
              {[
                { label: 'Salons Hosted', value: '150+' },
                { label: 'Connections Made', value: '2,000+' },
                { label: 'Return Rate', value: '95%' }
              ].map((stat, i) => (
                <Col key={i} span={8} style={{ textAlign: 'center' }}>
                  <p className="gold-text font-serif" style={{ fontSize: isMobile ? '24px' : '48px', fontWeight: 700, marginBottom: '8px' }}>{stat.value}</p>
                  <p style={{ color: '#52525B', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{stat.label}</p>
                </Col>
              ))}
            </Row>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section style={{ padding: isMobile ? '80px 24px' : '120px 0', backgroundColor: '#000' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: 'var(--gold)', fontSize: '12px', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '16px' }}>Success Stories</p>
          <h2 className="font-serif" style={{ fontSize: isMobile ? '32px' : '44px', marginBottom: '64px' }}>
            Voices of <span className="gold-text">Connection</span>
          </h2>

          <Row gutter={[24, 24]}>
            {[
              { author: 'Marcus T.', role: 'Angel Investor', content: "The cigar salon transformed my business relationships. What started as a tasting event led to a partnership worth seven figures. You can't put a price on genuine connection." },
              { author: 'Elena R.', role: 'Creative Director', content: "Finally, a community that understands high-end cigars isn't just for men. The Her Collection is exquisite, and the events are masterfully curated." },
              { author: 'David L.', role: 'Serial Entrepreneur', content: "JCigar has simplified my gifting game. From tracking my humidor to sending the perfect signature box, they've elevated every interaction I have with my clients." }
            ].map((t, i) => (
              <Col key={i} xs={24} md={8}>
                <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', padding: '40px', height: '100%', textAlign: 'left' }}>
                  <Text style={{ fontSize: '32px', color: 'rgba(197,165,90,0.3)', display: 'block', marginBottom: '16px' }}>"</Text>
                  <p className="font-italic-serif" style={{ color: 'var(--text-secondary)', fontSize: '18px', lineHeight: 1.6, marginBottom: '32px' }}>
                    {t.content}
                  </p>
                  <Space>
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#333' }} />
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{t.author}</p>
                      <p style={{ fontSize: '12px', color: 'var(--gold)' }}>{t.role}</p>
                    </div>
                  </Space>
                  <div style={{ marginTop: '24px', display: 'flex', gap: '4px' }}>
                    {[1, 2, 3, 4, 5].map(s => <StarFilled key={s} style={{ color: 'var(--gold)', fontSize: '12px' }} />)}
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '100px 24px 60px', backgroundColor: '#0A0A0A', borderTop: '1px solid #1A1A1A' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <Row gutter={[48, 48]}>
            <Col xs={24} md={10}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                <span className="font-serif" style={{ fontSize: '24px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  <span style={{ color: 'var(--gold)' }}>JCIGAR</span>
                  <span style={{ color: '#FFF', marginLeft: '4px' }}>CLUB</span>
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.8, maxWidth: '400px', marginBottom: '32px' }}>
                The world's leading community for refined tobacco enthusiasts and discerning connoisseurs. We believe in the art of connection through the cigar ceremony.
              </p>

            </Col>
            <Col xs={24} md={14}>
              <Row gutter={[24, 24]}>
                <Col xs={12} sm={8}>
                  <h4 className="font-serif" style={{ fontSize: '18px', marginBottom: '24px' }}>Offerings</h4>
                  <Space direction="vertical">
                    <a href="#" className="nav-link">Signature Box</a>
                    <a href="#" className="nav-link">Discovery Set</a>
                    <a href="#" className="nav-link">Her Series</a>
                    <a href="#" className="nav-link">Accessories</a>
                  </Space>
                </Col>
                <Col xs={12} sm={8}>
                  <h4 className="font-serif" style={{ fontSize: '18px', marginBottom: '24px' }}>Community</h4>
                  <Space direction="vertical">
                    <a href="#" className="nav-link">Taste Salon</a>
                    <a href="#" className="nav-link">Network</a>
                    <a href="#" className="nav-link">Private Club</a>
                    <a href="#" className="nav-link">Events</a>
                  </Space>
                </Col>
                <Col xs={24} sm={8}>
                  <h4 className="font-serif" style={{ fontSize: '18px', marginBottom: '24px' }}>Contact</h4>
                  <Space direction="vertical">
                    <Text style={{ color: 'var(--text-secondary)', fontSize: '13px' }}><EnvironmentOutlined /> Kuala Lumpur, MY</Text>
                    <Text style={{ color: 'var(--text-secondary)', fontSize: '13px' }}><CalendarOutlined /> Mon - Fri: 9am - 6pm</Text>
                    <Button
                      className="btn-gold"
                      style={{ height: '40px', width: '100%', marginTop: '16px' }}
                      onClick={() => {
                        window.open('https://api.whatsapp.com/send?phone=601157288278&text=Name%3A%0AContact%3A%0ABudget%3A%0APreferred%20date%3A%0A/', '_blank')
                      }}
                    >
                      Contact Us
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Col>
          </Row>
          <div style={{ marginTop: '80px', paddingTop: '40px', borderTop: '1px solid #1A1A1A', textAlign: 'center' }}>
            <p style={{ color: '#52525B', fontSize: '12px' }}>
              &copy; {new Date().getFullYear()} JCIGAR CLUB. ALL RIGHTS RESERVED. FOR ADULT ENTHUSIASTS ONLY.
            </p>
          </div>
        </div>
      </footer>

      {/* Mobile Menu Overlay */}
      <div style={{
        position: 'fixed',
        top: mobileMenuVisible ? 0 : '-100%',
        left: 0,
        width: '100%',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(15px)',
        zIndex: 2000,
        transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: mobileMenuVisible ? 1 : 0,
        visibility: mobileMenuVisible ? 'visible' : 'hidden',
        padding: '24px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '60px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="font-serif" style={{ fontSize: '24px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E5E5E5' }}>
              <span style={{ color: 'var(--gold)' }}>GENTLEMEN</span>CLUB
            </span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', letterSpacing: '0.3em', marginTop: '4px' }}>#BEYONDBUSINESS</span>
          </div>
          <button
            type="button"
            className="mobile-menu-icon-button"
            aria-label="Close navigation menu"
            onClick={() => setMobileMenuVisible(false)}
            style={{ marginLeft: 0 }}
          >
            <CloseOutlined style={{ fontSize: '24px' }} aria-hidden="true" />
          </button>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          padding: '0 10px'
        }}>
          <a href="#home" onClick={() => setMobileMenuVisible(false)} style={{ color: '#fff', fontSize: '16px', letterSpacing: '0.15em', textDecoration: 'none', fontWeight: 500 }}>
            {t('navigation.home').toUpperCase()}
          </a>
          <a href="#problem-solution" onClick={() => setMobileMenuVisible(false)} style={{ color: '#fff', fontSize: '16px', letterSpacing: '0.15em', textDecoration: 'none', fontWeight: 500 }}>
            {t('navigation.about').toUpperCase()}
          </a>
          <a href="#offerings" onClick={() => setMobileMenuVisible(false)} style={{ color: '#fff', fontSize: '16px', letterSpacing: '0.15em', textDecoration: 'none', fontWeight: 500 }}>
            {t('navigation.collections').toUpperCase()}
          </a>
          <a href="#trust" onClick={() => setMobileMenuVisible(false)} style={{ color: '#fff', fontSize: '16px', letterSpacing: '0.15em', textDecoration: 'none', fontWeight: 500 }}>
            {t('navigation.salonEvents').toUpperCase()}
          </a>

          <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Button
              className="btn-gold"
              onClick={() => {
                setAuthMode('login')
                setAuthModalVisible(true)
                setMobileMenuVisible(false)
              }}
              style={{
                width: '100%',
                height: '48px',
                fontSize: '14px',
                letterSpacing: '0.1em',
                fontWeight: 600
              }}
            >
              BECOME A MEMBER
            </Button>

            <a
              href="https://api.whatsapp.com/send?phone=601157288278&text=Name%3A%0AContact%3A%0ABudget%3A%0APreferred%20date%3A%0A"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                width: '100%',
                padding: '12px',
                textAlign: 'center',
                border: '1px solid var(--gold)',
                color: 'var(--gold)',
                textDecoration: 'none',
                fontSize: '14px',
                letterSpacing: '0.1em',
                transition: 'all 0.3s ease'
              }}
              className="btn-outline-gold"
            >
              {t('navigation.contact').toUpperCase()}
            </a>
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      <Modal
        open={authModalVisible}
        onCancel={() => {
          setAuthModalVisible(false)
          setLoginError('')
        }}
        footer={null}
        width={400}
        centered
        styles={{
          mask: {
            backdropFilter: 'blur(10px)',
            background: 'rgba(0, 0, 0, 0.4)'
          },
          content: {
            maxWidth: '400px',
            background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.98) 0%, rgba(45, 45, 45, 0.95) 100%)',
            border: '1px solid rgba(197, 165, 90, 0.4)',
            borderRadius: '20px',
            backdropFilter: 'blur(30px)',
            padding: 0,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }
        }}
      >
        <div className="ant-card-body" style={{ padding: '24px 0' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ textAlign: 'center', paddingTop: '10px' }}>
              {appConfig?.logoUrl && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <img src={appConfig.logoUrl} alt="Logo" style={{ height: '50px', objectFit: 'contain' }} />
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
                letterSpacing: '2px',
                fontSize: '28px'
              }}>
                {appConfig?.appName || 'Cigar Club'}
              </Title>
              <Text style={{ color: '#c0c0c0', fontSize: '16px' }}>
                {authMode === 'login'
                  ? t('auth.welcomeBack')
                  : t('auth.createAccountSubtitle', { defaultValue: `Create an account` })
                }
              </Text>
            </div>

            {authMode === 'login' ? (
              <Form form={loginForm} onFinish={handleLogin} layout="vertical" size="large" style={{ padding: '0 30px' }}>
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
                  <a onClick={() => navigate('/')} style={{ color: '#ffd700', fontSize: '14px', cursor: 'pointer' }}>
                    {t('auth.resetPassword')}
                  </a>
                </div>

                <Button
                  type="primary"
                  htmlType="submit"
                  loading={authLoading}
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
                        background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
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
              <Form form={registerForm} onFinish={handleRegister} layout="vertical" size="large" style={{ padding: '0 30px' }}>
                <Form.Item
                  name="displayName"
                  rules={[{ required: true, message: t('auth.nameRequired') }]}
                  style={{ marginBottom: '12px' }}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.name')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="phone"
                  rules={[
                    { required: true, message: t('auth.phoneRequired') },
                    {
                      pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/,
                      message: t('auth.phoneFormatInvalid')
                    },
                    {
                      validator: async (_, value) => {
                        if (!value) return Promise.resolve()
                        const formatPattern = /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/
                        if (!formatPattern.test(value)) return Promise.resolve()

                        const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
                        const { db } = await import('../../../config/firebase')
                        const { normalizePhoneNumber } = await import('../../../utils/phoneNormalization')

                        const normalized = normalizePhoneNumber(value)
                        if (!normalized) return Promise.resolve()

                        try {
                          const phoneQuery = query(collection(db, 'users'), where('profile.phone', '==', normalized), limit(1))
                          const phoneSnap = await getDocs(phoneQuery)
                          if (!phoneSnap.empty) return Promise.reject(new Error(t('auth.phoneAlreadyRegistered')))
                        } catch (e) { }
                        return Promise.resolve()
                      }
                    }
                  ]}
                  getValueFromEvent={(e) => e.target.value.replace(/[^\d+]/g, '')}
                  validateTrigger={['onBlur']}
                  style={{ marginBottom: '12px' }}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.phone')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="email"
                  rules={[
                    { required: true, type: 'email', message: t('auth.emailRequired') },
                    {
                      validator: async (_, value) => {
                        if (!value || !isValidEmail(value)) return Promise.resolve()
                        const { collection, query, where, getDocs, limit } = await import('firebase/firestore')
                        const { db } = await import('../../../config/firebase')
                        try {
                          const emailQuery = query(collection(db, 'users'), where('email', '==', value.toLowerCase().trim()), limit(1))
                          const emailSnap = await getDocs(emailQuery)
                          if (!emailSnap.empty) return Promise.reject(new Error(t('auth.emailAlreadyRegistered')))
                        } catch (e) { }
                        return Promise.resolve()
                      }
                    }
                  ]}
                  validateTrigger={['onBlur']}
                  style={{ marginBottom: '12px' }}
                >
                  <Input
                    prefix={<MailOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.email')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="password"
                  rules={[
                    { required: true, message: t('auth.passwordRequired') },
                    { min: 6, message: t('auth.passwordMinLength') }
                  ]}
                  style={{ marginBottom: '12px' }}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.password')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  dependencies={['password']}
                  rules={[
                    { required: true, message: t('auth.confirmPasswordRequired') },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue('password') === value) return Promise.resolve();
                        return Promise.reject(new Error(t('auth.passwordsDoNotMatch')));
                      },
                    }),
                  ]}
                  style={{ marginBottom: '12px' }}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.confirmPassword')}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>

                <Form.Item name="referralCode" style={{ marginBottom: '12px' }}>
                  <Input
                    prefix={<GiftOutlined style={{ color: '#ffd700' }} />}
                    placeholder={t('auth.referralCodePlaceholder')}
                    onInput={(e) => { e.currentTarget.value = e.currentTarget.value.toUpperCase() }}
                    style={{
                      background: 'rgba(45, 45, 45, 0.8)',
                      border: '1px solid #444444',
                      borderRadius: '8px',
                      color: '#f8f8f8'
                    }}
                  />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  loading={authLoading}
                  style={{
                    width: '100%',
                    height: '48px',
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#221c10',
                    fontSize: '16px',
                    fontWeight: 600,
                    marginTop: '10px',
                    boxShadow: '0 4px 20px rgba(255, 215, 0, 0.3)'
                  }}
                >
                  {t('auth.register')}
                </Button>
                <div style={{ textAlign: 'center', marginTop: '24px', paddingBottom: '10px' }}>
                  <Text style={{ color: '#999999', fontSize: '14px' }}>
                    {t('auth.alreadyHaveAccount')}{' '}
                    <a
                      onClick={() => setAuthMode('login')}
                      style={{
                        background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {t('auth.signIn')}
                    </a>
                  </Text>
                </div>
              </Form>
            )}
          </Space>
        </div>
      </Modal>

      {/* Salon Special Offer Modal */}
      <Modal
        open={salonModalVisible}
        onCancel={() => setSalonModalVisible(false)}
        footer={null}
        width={isMobile ? 'calc(100vw - 32px)' : 500}
        centered
        styles={{
          mask: { backdropFilter: 'blur(12px)', background: 'rgba(0, 0, 0, 0.6)' },
          content: {
            padding: 0,
            background: '#111',
            borderRadius: isMobile ? '18px' : '24px',
            overflow: 'hidden',
            border: '1px solid rgba(197, 165, 90, 0.4)'
          }
        }}
      >
        <div style={{ position: 'relative' }}>
          <div style={{ height: isMobile ? '180px' : '300px', overflow: 'hidden' }}>
            <img
              src="https://images.pexels.com/photos/25747045/pexels-photo-25747045.jpeg"
              alt="Monthly Taste Salon"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Tag Overlay */}
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '20px',
              background: 'var(--gold)',
              color: '#000',
              padding: '6px 16px',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              borderRadius: '20px'
            }}>
              SPECIAL OFFER
            </div>
          </div>

          <div style={{ padding: isMobile ? '24px 18px' : '40px 32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--gold)', fontSize: isMobile ? '12px' : '14px', letterSpacing: isMobile ? '0.22em' : '0.4em', textTransform: 'uppercase', marginBottom: '16px' }}>Exclusive Experience</p>
            <h2 className="font-serif" style={{ fontSize: isMobile ? '28px' : '36px', marginBottom: '16px', color: '#FFF' }}>Monthly Taste <span className="gold-text">Salon</span></h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: isMobile ? '14px' : '16px', lineHeight: isMobile ? 1.6 : 1.8, marginBottom: isMobile ? '24px' : '32px' }}>
              Join our monthly gathering of connoisseurs. Indulge in premium cigars, curated food, and spirits for only <span style={{ color: '#FFF', fontWeight: 600 }}>RM 150</span>.
            </p>

            <Button
              className="btn-gold"
              style={{
                minHeight: '50px',
                height: 'auto',
                width: '100%',
                padding: isMobile ? '12px 14px' : '0 18px',
                fontSize: isMobile ? '14px' : '16px',
                fontWeight: 600,
                letterSpacing: isMobile ? '0.05em' : '0.1em',
                lineHeight: 1.25,
                whiteSpace: 'normal'
              }}
              onClick={() => {
                window.open('https://api.whatsapp.com/send?phone=601157288278&text=I%20am%20interested%20in%20joining%20the%20Monthly%20Taste%20Salon!/', '_blank');
                setSalonModalVisible(false);
              }}
            >
              BOOK YOUR SEAT NOW
            </Button>

            <button
              type="button"
              className="nav-link"
              style={{ marginTop: '20px', display: 'inline-block', fontSize: '14px', opacity: 0.6, border: 0, background: 'transparent', cursor: 'pointer' }}
              onClick={() => setSalonModalVisible(false)}
            >
              Maybe later
            </button>
          </div>
        </div>
      </Modal>

      <style>{`
        .auth-input {
          background: rgba(255, 255, 255, 0.05) !important;
          border: 1px solid rgba(197, 165, 90, 0.2) !important;
          border-radius: 8px !important;
          color: #fff !important;
        }
        .auth-input:focus {
          border-color: var(--gold) !important;
          box-shadow: 0 0 0 2px rgba(197, 165, 90, 0.1) !important;
        }
        .auth-input input {
          background: transparent !important;
          color: #fff !important;
        }
        .ant-modal-close {
          color: var(--gold) !important;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .error-shake {
          animation: shake 0.5s;
          border-color: #ff4d4f !important;
        }
      `}</style>
    </div>
  )
}

export default Landing
