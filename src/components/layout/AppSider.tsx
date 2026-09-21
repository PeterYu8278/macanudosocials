// 应用侧边栏组件 - Cigar Club黑金主题
import React, { useState, useEffect, useMemo } from 'react'
import { Layout, Menu, Button, Typography, Divider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  HomeOutlined,
  CalendarOutlined,
  ShoppingOutlined,
  UserOutlined,
  DashboardOutlined,
  TeamOutlined,
  DatabaseOutlined,
  DollarOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  FireOutlined,
  TrophyOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { useAuthStore } from '../../store/modules/auth'
import { useTranslation } from 'react-i18next'
import { NAV_KEYS } from '../../i18n/constants'
import { getFeaturesVisibility } from '../../services/firebase/featureVisibility'
import { getFeatureKeyByRoute } from '../../config/featureDefinitions'
import LanguageSwitcher from '../common/LanguageSwitcher'
import { getAppConfig } from '../../services/firebase/appConfig'
import type { AppConfig } from '../../types'

const { Sider } = Layout
const { Text } = Typography

interface AppSiderProps {
  onCollapseChange?: (collapsed: boolean) => void
}

const AppSider: React.FC<AppSiderProps> = ({ onCollapseChange }) => {
  const [collapsed, setCollapsed] = useState(false)
  const [featuresVisibility, setFeaturesVisibility] = useState<Record<string, boolean>>({})
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, isSuperAdmin, isDeveloper, user } = useAuthStore()
  const isStoreAdmin = user?.role === 'storeAdmin'
  const { t, i18n } = useTranslation()

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

  // 加载功能可见性配置
  useEffect(() => {
    const loadVisibility = async () => {
      const visibility = await getFeaturesVisibility()
      setFeaturesVisibility(visibility)
    }
    loadVisibility()
  }, [])

  // 处理侧边栏收起/展开
  const handleCollapseChange = (collapsed: boolean) => {
    setCollapsed(collapsed)
    onCollapseChange?.(collapsed)
    try {
      const width = collapsed ? '64px' : '240px'
      document.documentElement.style.setProperty('--sider-width', width)
    } catch { }
  }

  // 前端菜单项
  const frontendMenuItemsBase = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: t(NAV_KEYS.HOME),
    },
    {
      key: '/events',
      icon: <CalendarOutlined />,
      label: t(NAV_KEYS.EVENTS),
    },
    {
      key: '/shop',
      icon: <ShopOutlined />,
      label: t(NAV_KEYS.SHOP),
    },
    {
      key: '/profile',
      icon: <UserOutlined />,
      label: t(NAV_KEYS.PROFILE),
    },
  ]

  // 管理后台菜单项
  const adminMenuItemsBase = [
    {
      key: '/admin',
      icon: <DashboardOutlined />,
      label: t(NAV_KEYS.DASHBOARD),
    },
    {
      key: '/admin/users',
      icon: <TeamOutlined />,
      label: t(NAV_KEYS.USERS),
    },
    {
      key: '/admin/events',
      icon: <CalendarOutlined />,
      label: t(NAV_KEYS.EVENTS),
    },
    {
      key: '/admin/orders',
      icon: <ShoppingCartOutlined />,
      label: t(NAV_KEYS.ORDERS),
    },
    {
      key: '/admin/inventory',
      icon: <DatabaseOutlined />,
      label: t(NAV_KEYS.INVENTORY),
    },
    {
      key: '/admin/reports',
      icon: <FileTextOutlined />,
      label: t('navigation.reports'),
    },
    {
      key: '/admin/finance',
      icon: <DollarOutlined />,
      label: t(NAV_KEYS.FINANCE),
    },
    {
      key: '/admin/points-config',
      icon: <TrophyOutlined />,
      label: t('navigation.pointsConfig'),
    },
    {
      key: '/admin/visit-sessions',
      icon: <ClockCircleOutlined />,
      label: t('navigation.visitSessions'),
    },
  ]

  // 根据功能可见性过滤菜单项（developer 不受限制）
  const frontendMenuItems = useMemo(() => {
    if (isDeveloper) return frontendMenuItemsBase
    return frontendMenuItemsBase.filter(item => {
      const featureKey = getFeatureKeyByRoute(item.key)
      return featureKey ? (featuresVisibility[featureKey] ?? true) : true
    })
  }, [featuresVisibility, isDeveloper, t])

  // 最终合并所有菜单项，并添加分组和分割线
  const menuItems = useMemo(() => {
    const items: any[] = [...frontendMenuItems]

    // 管理后台分组
    if (isAdmin || isStoreAdmin) {
      const filteredAdminBase = adminMenuItemsBase.filter(item => {
        // 角色权限检查
        if (isStoreAdmin && !['admin/points-config'].some(k => item.key.includes(k))) return false;
        if (item.key === '/admin/finance' && !isSuperAdmin) return false;

        if (isDeveloper) return true;
        const featureKey = getFeatureKeyByRoute(item.key);
        return featureKey ? (featuresVisibility[featureKey] ?? true) : true;
      });

      if (filteredAdminBase.length > 0) {
        items.push({ type: 'divider' })
        items.push({
          key: 'admin-section',
          label: !collapsed ? t('navigation.adminSection') : '',
          type: 'group',
          children: filteredAdminBase
        })
      }
    }

    // 开发者/系统管理分组
    const developerItems: any[] = []
    if (isSuperAdmin || isDeveloper) {
      developerItems.push({
        key: '/admin/system-config',
        icon: <SettingOutlined />,
        label: t('navigation.systemConfig', 'System Config'),
      })
    }
    if (isDeveloper) {
      developerItems.push({
        key: '/developer/feature-management',
        icon: <SettingOutlined />,
        label: t('navigation.featureManagement'),
      })
      developerItems.push({
        key: '/developer/subscription',
        icon: <SettingOutlined />,
        label: t('navigation.subscription'),
      })
    }
    if (isDeveloper) {
      developerItems.push({
        key: '/developer/invoice-template',
        icon: <FileTextOutlined />,
        label: t('navigation.invoiceTemplate'),
      })
    }

    if (developerItems.length > 0) {
      items.push({ type: 'divider' })
      items.push({
        key: 'developer-section',
        label: !collapsed ? t('navigation.developerSection') : '',
        type: 'group',
        children: developerItems
      })
    }

    return items
  }, [frontendMenuItems, adminMenuItemsBase, featuresVisibility, isAdmin, isStoreAdmin, isSuperAdmin, isDeveloper, collapsed, t])

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={240}
      collapsedWidth={64}
      className="cigar-sider-scroll"
      style={{
        background: 'linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%)',
        borderRight: '2px solid #ffd700',
        boxShadow: '2px 0 8px rgba(0, 0, 0, 0.3)',
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 2000
      }}
    >
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(180deg, rgba(255, 215, 0, 0.03) 0%, transparent 100%)',
        pointerEvents: 'none'
      }} />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px',
        borderBottom: '1px solid #333333',
        position: 'relative'
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FireOutlined style={{ color: '#ffd700', fontSize: '18px' }} />
            <Text style={{
              fontWeight: 'bold',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontSize: '16px',
              letterSpacing: '1px'
            }}>
              {appConfig?.appName || 'Cigar Club'}
            </Text>
          </div>
        )}
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => handleCollapseChange(!collapsed)}
          style={{
            fontSize: '16px',
            width: 28,
            height: 28,
            color: '#c0c0c0'
          }}
          className="sider-toggle-button"
        />
      </div>

      <style>{`
        .cigar-sidebar-menu .ant-menu-item-group-title {
          background: linear-gradient(to right, #FDE08D, #C48D3A);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 800;
          font-size: 11px;
          letter-spacing: 2px;
          padding-top: 16px;
          padding-bottom: 8px;
          opacity: 0.8;
          text-transform: uppercase;
        }
        .cigar-sidebar-menu .ant-menu-item-group-list {
          padding: 0 4px;
        }
        .cigar-sidebar-menu .ant-menu-divider {
          border-color: rgba(255, 215, 0, 0.15) !important;
          margin: 8px 16px !important;
        }
        /* Hover and Active Styles */
        .cigar-sidebar-menu .ant-menu-item:hover,
        .cigar-sidebar-menu .ant-menu-item-active {
          background: linear-gradient(to right, #FDE08D, #C48D3A) !important;
          color: #000000 !important;
          font-weight: 700 !important;
        }
        .cigar-sidebar-menu .ant-menu-item:hover .anticon,
        .cigar-sidebar-menu .ant-menu-item-active .anticon {
          color: #000000 !important;
        }
        /* Selected State */
        .cigar-sidebar-menu .ant-tabs-tab-active,
        .cigar-sidebar-menu .ant-menu-item-selected {
          background: linear-gradient(to right, #FDE08D, #C48D3A) !important;
          color: #000000 !important;
          font-weight: 700 !important;
        }
        .cigar-sidebar-menu .ant-menu-item-selected .anticon {
          color: #000000 !important;
        }
        /* Default item text color */
        .cigar-sidebar-menu .ant-menu-item {
          color: rgba(255, 255, 255, 0.75);
          transition: all 0.3s ease;
        }
        /* Layout flex and scroll management */
        .ant-layout-sider-children {
          display: flex !important;
          flex-direction: column !important;
        }
        .cigar-menu-wrapper {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
        }
        /* Hide scrollbar for the menu wrapper */
        .cigar-menu-wrapper::-webkit-scrollbar {
          width: 0px;
          display: none;
          background: transparent;
        }
        .cigar-menu-wrapper {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
      `}</style>
      <div className="cigar-menu-wrapper">
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            borderRight: 0,
            background: 'transparent',
            marginTop: '8px'
          }}
          className="cigar-sidebar-menu"
        />
      </div>

    </Sider>
  )
}

export default AppSider
