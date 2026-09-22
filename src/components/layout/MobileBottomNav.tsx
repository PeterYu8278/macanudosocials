// 手机端底部导航组件 - Cigar Club黑金主题
import React, { useState, useEffect, useMemo } from 'react'
import { Badge } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  HomeOutlined,
  CalendarOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  DashboardOutlined,
  DollarOutlined,
  QrcodeOutlined,
  TrophyOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { useAuthStore } from '../../store/modules/auth'
import { useCartStore } from '../../store/modules'
import { useTranslation } from 'react-i18next'
import { UniversalScanner } from '../common/UniversalScanner'
import { getFeaturesVisibility } from '../../services/firebase/featureVisibility'
import { getFeatureKeyByRoute } from '../../config/featureDefinitions'

const MobileBottomNav: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, isDeveloper } = useAuthStore()
  const quantities = useCartStore((state) => state.quantities)
  const { t } = useTranslation()
  const [scannerVisible, setScannerVisible] = useState(false)
  const [featuresVisibility, setFeaturesVisibility] = useState<Record<string, boolean>>({})
  const cartItemCount = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)

  // 只有管理员和开发者可以访问扫码功能
  const canAccessQR = isAdmin || isDeveloper

  // 加载功能可见性配置
  useEffect(() => {
    const loadVisibility = async () => {
      const visibility = await getFeaturesVisibility()
      setFeaturesVisibility(visibility)
    }
    loadVisibility()
  }, [])

  // 检查 AI识茄 功能是否可见
  const aiCigarVisible = isDeveloper ? true : (featuresVisibility['ai-cigar'] ?? true)
  
  // 普通会员：如果 AI识茄 功能被隐藏，则隐藏扫码按钮
  // 管理员/开发者：始终显示扫码按钮
  const showScannerButton = canAccessQR || aiCigarVisible
  const scannerLabel = canAccessQR
    ? t('navigation.scan', { defaultValue: 'Scan' })
    : t('navigation.aiScanner', { defaultValue: 'AI Scan' })

  // 普通用户导航项
  const frontendNavItemsBase = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: t('navigation.home'),
      badge: null
    },
    {
      key: '/events',
      icon: <CalendarOutlined />,
      label: t('navigation.events'),
      badge: null
    },
    {
      key: '/shop',
      icon: <ShoppingCartOutlined />,
      label: t('navigation.shop'),
      badge: cartItemCount > 0 ? cartItemCount : null
    },
    {
      key: '/profile',
      icon: <UserOutlined />,
      label: t('navigation.profile'),
      badge: null
    }
  ]

  // 管理员导航项
  const adminNavItemsBase = [
    {
      key: '/admin',
      icon: <DashboardOutlined />,
      label: t('navigation.dashboard'),
      badge: null
    },
    {
      key: '/admin/finance',
      icon: <DollarOutlined />,
      label: t('navigation.finance'),
      badge: null
    },
    {
      key: '/admin/points-config',
      icon: <TrophyOutlined />,
      label: t('navigation.pointsConfig'),
      badge: null
    },
    {
      key: '/admin/visit-sessions',
      icon: <ClockCircleOutlined />,
      label: t('navigation.visitSessions'),
      badge: null
    }
  ]

  // 根据功能可见性过滤导航项
  const frontendNavItems = useMemo(() => {
    if (isDeveloper) {
      return frontendNavItemsBase
    }
    return frontendNavItemsBase.filter(item => {
      const featureKey = getFeatureKeyByRoute(item.key)
      return featureKey ? (featuresVisibility[featureKey] ?? true) : true
    })
  }, [featuresVisibility, isDeveloper, t, cartItemCount])

  const adminNavItems = useMemo(() => {
    if (isDeveloper) {
      return adminNavItemsBase
    }
    return adminNavItemsBase.filter(item => {
      const featureKey = getFeatureKeyByRoute(item.key)
      return featureKey ? (featuresVisibility[featureKey] ?? true) : true
    })
  }, [featuresVisibility, isDeveloper, t])

  // 判断当前是否在管理后台
  const isInAdminPanel = location.pathname.startsWith('/admin')

  // 决定当前显示的导航项集合
  const navItems = isInAdminPanel && isAdmin ? adminNavItems : frontendNavItems

  // 将导航项分成两部分（中间插入QR按钮）
  const getDisplayItems = () => {
    const middleIndex = Math.ceil(navItems.length / 2)
    return {
      leftItems: navItems.slice(0, middleIndex),
      rightItems: navItems.slice(middleIndex)
    }
  }

  const { leftItems, rightItems } = getDisplayItems()
  const totalItemsCount = navItems.length + (showScannerButton ? 1 : 0) // +1 for scanner button if visible
  const itemWidth = `${100 / totalItemsCount}%`

  const handleNavClick = (path: string) => {
    navigate(path)
  }

  const handleScanClick = () => {
    setScannerVisible(true)
  }

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    if (path === '/admin') {
      return location.pathname === '/admin'
    }
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const activeNavIndex = navItems.findIndex(item => isActive(item.key))
  const middleIndex = leftItems.length
  const activeDisplayIndex = activeNavIndex < 0
    ? 0
    : activeNavIndex < middleIndex
      ? activeNavIndex
      : activeNavIndex + (showScannerButton ? 1 : 0)

  const renderNavItem = (item: typeof navItems[0]) => {
    const active = isActive(item.key)
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => handleNavClick(item.key)}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: '4px 2px 3px',
          width: itemWidth,
          minWidth: 0,
          height: '64px',
          transition: 'color 0.2s ease',
          position: 'relative',
          zIndex: 1,
          borderRadius: '8px'
        }}
        className={`mobile-nav-item${active ? ' mobile-nav-item-active' : ''}`}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '3px',
          position: 'relative',
          width: '58px',
          height: '32px',
          borderRadius: '18px',
          background: 'transparent'
        }}>
          <div style={{
            fontSize: '20px',
            color: active ? '#111111' : '#8f96a3',
            lineHeight: 1,
            transition: 'color 0.2s ease'
          }}>
            {item.icon}
          </div>
          {item.badge && (
            <Badge
              count={item.badge}
              size="small"
              color="#ffd700"
              style={{
                position: 'absolute',
                top: '-5px',
                right: '1px',
                zIndex: 1001,
                fontSize: '10px'
              }}
            />
          )}
        </div>

        <div style={{
          fontSize: '10.5px',
          color: active ? '#FFD65A' : '#8f96a3',
          fontWeight: active ? 600 : 400,
          textAlign: 'center',
          lineHeight: 1.2,
          transition: 'color 0.2s ease',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%'
        }}>
          {item.label}
        </div>
      </button>
    )
  }

  return (
    <div
      role="toolbar"
      aria-label="Bottom actions"
      style={{
        position: 'fixed',
        bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
        left: '8px',
        right: '8px',
        height: '72px',
        background: 'rgba(20, 22, 27, 0.97)',
        border: '1px solid rgba(255, 215, 0, 0.16)',
        borderRadius: '28px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: '4px 8px',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.48)'
      }}
      className="mobile-bottom-nav mobile-bottom-action-bar"
      data-nav-count={totalItemsCount}
    >
      <div
        aria-hidden="true"
        className="mobile-nav-highlight-track"
        style={{
          position: 'absolute',
          top: '12px',
          left: '8px',
          right: '8px',
          height: '32px',
          pointerEvents: 'none',
          zIndex: 0
        }}
      >
        <span
          style={{
            width: `${100 / totalItemsCount}%`,
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateX(${activeDisplayIndex * 100}%)`,
            transition: 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        >
          <span
            style={{
              width: '58px',
              height: '32px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #FDE08D 0%, #D69D3D 100%)',
              boxShadow: '0 3px 10px rgba(255, 214, 90, 0.2)'
            }}
          />
        </span>
      </div>

      {/* 左侧导航项 */}
      {leftItems.map(renderNavItem)}

      {/* 中间的扫描按钮（仅在显示时渲染） */}
      {showScannerButton && (
        <button
          type="button"
          onClick={handleScanClick}
          aria-label={canAccessQR ? 'Open QR scanner' : 'Open AI cigar scanner'}
          className="mobile-nav-item mobile-nav-scan-button"
          style={{
            width: itemWidth,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 10,
            height: '64px',
            minWidth: 0,
            padding: '4px 2px 3px',
            cursor: 'pointer',
            borderRadius: '8px'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '58px',
              height: '32px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #FDE08D 0%, #D69D3D 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '3px',
              boxShadow: '0 3px 10px rgba(255, 214, 90, 0.2)'
            }}
          >
            <QrcodeOutlined
              className="qr-icon-large"
              style={{ fontSize: '23px', color: '#111' }}
            />
          </span>
          <span
            style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#FFD65A',
              fontSize: '10.5px',
              fontWeight: 600,
              lineHeight: 1.2
            }}
          >
            {scannerLabel}
          </span>
        </button>
      )}

      {/* 右侧导航项 */}
      {rightItems.map(renderNavItem)}

      {/* 通用扫描器 */}
      <UniversalScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        defaultTab={canAccessQR ? 'qr' : 'ai'} // 管理员和开发者默认扫码(checkin)，普通用户默认AI
      />
    </div>
  )
}

export default MobileBottomNav
