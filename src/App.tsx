
import React, { useState, useEffect, Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout, App as AntApp } from 'antd'
import AppSider from './components/layout/AppSider'
import AppFooter from './components/layout/AppFooter'
import MobileBottomNav from './components/layout/MobileBottomNav'
import ProtectedRoute from './components/common/ProtectedRoute'
import { useAuthStore } from './store/modules/auth'
import { getAppConfig } from './services/firebase/appConfig'
import { applyDynamicIcons } from './utils/dynamicManifest'
import { saveAppConfigToIndexedDB } from './utils/indexedDB'
import { PageLoading } from './components/common/LoadingSpinner'

// --- 前端页面 (Lazy Loaded) ---
const Home = lazy(() => import('./views/frontend/Home'))
const Events = lazy(() => import('./views/frontend/Events'))
const Shop = lazy(() => import('./views/frontend/Shop'))
const Profile = lazy(() => import('./views/frontend/Profile'))
const BrandDetail = lazy(() => import('./views/frontend/BrandDetail'))
const ReloadPage = lazy(() => import('./views/frontend/Reload'))
const AICigarHistory = lazy(() => import('./views/frontend/AICigarHistory'))
const Landing = lazy(() => import('./views/frontend/Landing'))
const PaymentResult = lazy(() => import('./views/frontend/PaymentResult'))

// --- 管理后台页面 (Lazy Loaded) ---
const AdminDashboard = lazy(() => import('./views/admin/Dashboard'))
const AdminUsers = lazy(() => import('./views/admin/Users'))
const AdminInventory = lazy(() => import('./views/admin/Inventory'))
const AdminEvents = lazy(() => import('./views/admin/Events'))
const AdminOrders = lazy(() => import('./views/admin/Orders'))
const AdminFinance = lazy(() => import('./views/admin/Finance'))
const CloudinaryTestPage = lazy(() => import('./views/admin/CloudinaryTest'))
const PerformanceMonitor = lazy(() => import('./components/admin/PerformanceMonitor'))
const EventOrderDebug = lazy(() => import('./views/admin/EventOrderDebug'))
const PointsConfigPage = lazy(() => import('./views/admin/PointsConfig'))
const VisitSessionsPage = lazy(() => import('./views/admin/VisitSessions'))
const OrphanedUserCleanup = lazy(() => import('./views/admin/OrphanedUserCleanup'))
const FeatureManagement = lazy(() => import('./views/admin/FeatureManagement'))
const TestDataGenerator = lazy(() => import('./views/admin/TestDataGenerator'))
const CigarDatabase = lazy(() => import('./views/admin/CigarDatabase'))
const GeminiModelTester = lazy(() => import('./views/admin/GeminiModelTester'))
const InvoiceTemplateEditor = lazy(() => import('./views/admin/InvoiceTemplate'))
const SubscriptionSettings = lazy(() => import('./views/admin/SubscriptionSettings').then(m => ({ default: m.SubscriptionSettings })))
const StoreManagement = lazy(() => import('./views/admin/StoreManagement'))
const SystemConfig = lazy(() => import('./views/admin/SystemConfig'))
const AdminReports = lazy(() => import('./views/admin/Reports'))

// --- 认证页面 (Lazy Loaded) ---
const Register = lazy(() => import('./views/auth/Register'))
const CompleteProfile = lazy(() => import('./views/auth/CompleteProfile'))

const { Content } = Layout

const AppContent: React.FC = () => {
  const { user, isAdmin, loading: authLoading, initializeAuth } = useAuthStore()
  const location = useLocation()
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    if (typeof window.matchMedia !== 'function') return true
    return window.matchMedia('(min-width: 992px)').matches
  })
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  const [viewportHeight, setViewportHeight] = useState('100vh')

  // 在应用启动时初始化认证（仅一次）
  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  // 响应式更新 isDesktop（监听窗口大小变化）
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(min-width: 992px)')
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(e.matches)
    }

    // 初始化
    handleChange(mediaQuery)

    // 监听变化
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
      return () => {
        mediaQuery.removeEventListener('change', handleChange)
      }
    } else {
      // 兼容旧版浏览器
      mediaQuery.addListener(handleChange)
      return () => {
        mediaQuery.removeListener(handleChange)
      }
    }
  }, [])

  // 无需 padding 的页面（基础认证页面 + 商城页面 + 未登录首页 Landing）
  const noPaddingPages = ['/register', '/auth/complete-profile', '/shop', ...(user ? [] : ['/'])]
  const needsPadding = !noPaddingPages.includes(location.pathname)

  // 认证页面（不显示 footer/navigation，且需要居中显示）
  const authPages = ['/register', '/auth/complete-profile']
  const isAuthPage = authPages.includes(location.pathname)
  const shouldCenter = isAuthPage
  const isLandingPage = !authLoading && !user && location.pathname === '/'
  const isClippedLayout = !isLandingPage && !isAuthPage

  // 侧边栏显示逻辑：手机端商城页面隐藏，电脑端商城页面显示
  // 逻辑：已登录 AND (是电脑端 OR 不是商城页面)
  const showSider = !!(user && (isDesktop || location.pathname !== '/shop'))

  // 设置实际视口高度（适配移动设备地址栏）
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight
      setViewportHeight(`${vh}px`)
      // 同时设置 CSS 变量供全局使用
      document.documentElement.style.setProperty('--vh', `${vh * 0.01}px`)
    }

    setVH()
    window.addEventListener('resize', setVH)
    window.addEventListener('orientationchange', setVH)

    return () => {
      window.removeEventListener('resize', setVH)
      window.removeEventListener('orientationchange', setVH)
    }
  }, [])

  useEffect(() => {
    if (isLandingPage) {
      // Landing Page：完全原生滚动，不锁定高度
      document.body.style.height = 'auto'
      document.documentElement.style.height = 'auto'
      document.body.style.overflow = 'auto'
      document.documentElement.style.overflow = 'auto'
    } else if (isAuthPage) {
      // 认证页面：高度锁定，禁止外部滚动
      document.body.style.height = '100%'
      document.documentElement.style.height = '100%'
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      // 后台管理/其他页面：高度锁定，使用内部 Content 滚动
      document.body.style.height = '100%'
      document.documentElement.style.height = '100%'
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }

    return () => {
      // 清理：恢复默认状态
      document.body.style.height = '100%'
      document.documentElement.style.height = '100%'
      document.body.style.overflow = 'auto'
    }
  }, [isAuthPage, isLandingPage])

  // 动态更新页面标题、meta 标签和 PWA 图标
  useEffect(() => {
    let cleanupManifest: (() => void) | null = null

    const updateDocumentMeta = async () => {
      try {
        const config = await getAppConfig()
        const appName = config?.appName || 'Cigar Club'

        // 存储 appConfig 到 IndexedDB（供 Service Worker 使用）
        if (config) {
          try {
            await saveAppConfigToIndexedDB(config)
          } catch (error) {
            console.warn('[App] 保存 appConfig 到 IndexedDB 失败:', error)
          }
        }

        // Update document.title
        document.title = `${appName} - Premium Cigar Club`

        // 更新 meta 标签
        const updateMetaTag = (name: string, content: string, attribute: string = 'name') => {
          let meta = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement
          if (!meta) {
            meta = document.createElement('meta')
            meta.setAttribute(attribute, name)
            document.head.appendChild(meta)
          }
          meta.content = content
        }

        // Update description
        updateMetaTag('description', `${appName} - Premium Cigar Club`)

        // Update author
        updateMetaTag('author', appName)

        // Update apple-mobile-web-app-title
        updateMetaTag('apple-mobile-web-app-title', appName)

        // Update Open Graph
        updateMetaTag('og:title', `${appName} - Premium Cigar Club`, 'property')
        updateMetaTag('og:description', 'Premium membership platform for cigar lovers.', 'property')

        // Update Twitter Card
        updateMetaTag('twitter:title', `${appName} - Premium Cigar Club`)
        updateMetaTag('twitter:description', 'Premium membership platform for cigar lovers.')

        // 应用动态图标更新（包括 manifest、favicon、apple-touch-icon）
        // 注意：manifest 现在由 Service Worker 动态生成，这里只更新图标
        cleanupManifest = applyDynamicIcons(config)
      } catch (error) {
        console.warn('[App] 更新文档 meta 标签和图标失败:', error)
      }
    }

    updateDocumentMeta()

    // 清理函数：释放 blob URL（如果使用）
    return () => {
      if (cleanupManifest) {
        cleanupManifest()
      }
    }
  }, [])

  if (authLoading) {
    return (
      <Layout style={{
        height: viewportHeight,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at top, #3c2f1a, #121212)',
      }}>
        <PageLoading />
      </Layout>
    )
  }

  return (
    <Layout style={{
      height: isLandingPage ? 'auto' : viewportHeight,
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2d2d2d 100%)',
      position: 'relative',
      overflow: isLandingPage ? 'visible' : 'hidden'
    }}>
      {/* 全局背景装饰 */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `
            radial-gradient(circle at 20% 80%, rgba(255, 215, 0, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(255, 215, 0, 0.02) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(255, 215, 0, 0.01) 0%, transparent 50%)
          `,
        pointerEvents: 'none',
        zIndex: -1
      }} />

      <Layout style={{
        background: 'transparent',
        flex: 1,
        overflow: isLandingPage ? 'visible' : 'hidden'
      }}>
        {showSider && <AppSider onCollapseChange={setSiderCollapsed} />}
        <Layout style={{
          background: 'transparent',
          marginLeft: showSider && isDesktop ? (siderCollapsed ? 64 : 240) : 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: isLandingPage ? 'visible' : 'hidden'
        }}>
          <Content
            style={{
              paddingTop: needsPadding ? 12 : 0,
              paddingRight: needsPadding ? 12 : 0,
              paddingBottom: needsPadding ? 12 : 0,
              paddingLeft: needsPadding ? 12 : 0,
              margin: 0,
              flex: isLandingPage ? 'none' : 1,
              background: isLandingPage ? 'transparent' : 'radial-gradient(ellipse at top, #3c2f1a, #121212)',
              boxShadow: isLandingPage ? 'none' : '0 8px 32px rgba(0, 0, 0, 0.3)',
              backdropFilter: isLandingPage ? 'none' : 'blur(10px)',
              position: 'relative',
              overflow: isLandingPage ? 'visible' : (needsPadding ? 'auto' : 'hidden'),
              display: shouldCenter ? 'flex' : 'block',
              alignItems: shouldCenter ? 'center' : undefined,
              justifyContent: shouldCenter ? 'center' : undefined
            }}
          >
            {/* 内容区域背景装饰 */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.02) 0%, transparent 100%)',
              pointerEvents: 'none'
            }} />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  {/* 认证路由 */}
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/auth/complete-profile" element={<CompleteProfile />} />

                  {/* 前端路由 */}
                  <Route path="/" element={user ? <Home /> : <Landing />} />
                  <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
                  <Route path="/shop" element={<ProtectedRoute roles={['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer']}><Shop /></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute roles={['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer']}><Profile /></ProtectedRoute>} />
                  <Route path="/ai-cigar-history" element={<ProtectedRoute roles={['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer']}><AICigarHistory /></ProtectedRoute>} />
                  <Route path="/reload" element={<ProtectedRoute roles={['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer']}><ReloadPage /></ProtectedRoute>} />
                  <Route path="/payment/result" element={<PaymentResult />} />
                  <Route path="/brand/:brandId" element={<ProtectedRoute roles={['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer']}><BrandDetail /></ProtectedRoute>} />

                  {/* 管理后台路由 */}
                  <Route path="/admin" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminDashboard /></ProtectedRoute>} />
                  <Route path="/admin/users" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminUsers /></ProtectedRoute>} />
                  <Route path="/admin/inventory" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminInventory /></ProtectedRoute>} />
                  <Route path="/admin/events" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminEvents /></ProtectedRoute>} />
                  <Route path="/admin/orders" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminOrders /></ProtectedRoute>} />
                  <Route path="/admin/reports" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><AdminReports /></ProtectedRoute>} />
                  <Route path="/admin/finance" element={<ProtectedRoute roles={['superAdmin', 'developer']}><AdminFinance /></ProtectedRoute>} />
                  <Route path="/admin/points-config" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><PointsConfigPage /></ProtectedRoute>} />
                  <Route path="/admin/visit-sessions" element={<ProtectedRoute roles={['storeAdmin', 'admin', 'superAdmin', 'developer']}><VisitSessionsPage /></ProtectedRoute>} />
                  <Route path="/admin/stores" element={<ProtectedRoute roles={['superAdmin', 'developer']}><StoreManagement /></ProtectedRoute>} />
                  <Route path="/admin/system-config" element={<ProtectedRoute roles={['superAdmin', 'developer']}><SystemConfig /></ProtectedRoute>} />
                  <Route path="/developer/orphaned-users" element={<ProtectedRoute roles={['developer']}><OrphanedUserCleanup /></ProtectedRoute>} />
                  <Route path="/developer/performance" element={<ProtectedRoute roles={['developer']}><PerformanceMonitor /></ProtectedRoute>} />
                  <Route path="/developer/feature-management" element={<ProtectedRoute roles={['developer']}><FeatureManagement /></ProtectedRoute>} />
                  <Route path="/developer/subscription" element={<ProtectedRoute roles={['developer']}><SubscriptionSettings /></ProtectedRoute>} />
                  <Route path="/developer/invoice-template" element={<ProtectedRoute roles={['developer']}><InvoiceTemplateEditor /></ProtectedRoute>} />
                  <Route path="/developer/cigar-database" element={<ProtectedRoute roles={['developer']}><CigarDatabase /></ProtectedRoute>} />
                  <Route path="/developer/gemini-tester" element={<ProtectedRoute roles={['developer']}><GeminiModelTester /></ProtectedRoute>} />
                  <Route path="/developer/cloudinary-test" element={<ProtectedRoute roles={['developer']}><CloudinaryTestPage /></ProtectedRoute>} />
                  <Route path="/developer/debug-orders" element={<ProtectedRoute roles={['developer']}><EventOrderDebug /></ProtectedRoute>} />
                  <Route path="/developer/test-data-generator" element={<ProtectedRoute roles={['developer']}><TestDataGenerator /></ProtectedRoute>} />

                  {/* 默认重定向 */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </div>
          </Content>
          {user && !isAuthPage && <AppFooter />}
        </Layout>
      </Layout>

      {/* 手机端底部导航 */}
      {user && !isAuthPage && <MobileBottomNav />}
    </Layout>
  )
}

function App() {
  return (
    <Router>
      <AntApp>
        <AppContent />
      </AntApp>
    </Router>
  )
}

export default App

