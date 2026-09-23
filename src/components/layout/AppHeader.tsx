import React, { useState, useEffect } from 'react'
import { Layout, Space, Typography, Avatar, Dropdown, MenuProps, App } from 'antd'
import { LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/modules/auth'
import { logoutUser } from '../../services/firebase/auth'
import LanguageSwitcher from '../common/LanguageSwitcher'
import { getAppConfig } from '../../services/firebase/appConfig'
import type { AppConfig } from '../../types'

const { Header } = Layout
const { Text } = Typography

interface AppHeaderProps {
  siderCollapsed?: boolean
  isDesktop?: boolean
  showSider?: boolean
}

/**
 * 应用顶部栏
 * - 语言切换
 * - 通知中心
 * - 购物车徽标
 * - 用户信息（头像、昵称、角色标签）
 */
const AppHeader: React.FC<AppHeaderProps> = ({ siderCollapsed = false, isDesktop = true, showSider = false }) => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)

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

  // 用户下拉菜单
  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('navigation.profile', { defaultValue: '个人资料' }),
      onClick: () => navigate('/profile')
    },
    {
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout', { defaultValue: '登出' }),
      danger: true,
      onClick: handleLogout
    }
  ]

  // 根据侧边栏状态计算 marginLeft
  const headerMarginLeft = showSider && isDesktop ? (siderCollapsed ? 64 : 240) : 0

  return (
    <Header
      style={{
        height: 64,
        lineHeight: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        padding: '0 24px',
        borderBottom: '2px solid rgb(255,215,0)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        overflow: 'hidden',
        marginLeft: headerMarginLeft,
        transition: 'margin-left 0.2s ease'
      }}
      className="ant-layout-header"
    >
      {/* 背景装饰条 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(255,215,0,0.05) 0%, transparent 50%, rgba(255,215,0,0.05) 100%)',
          pointerEvents: 'none'
        }}
      />

      {/* 左侧占位 */}
      <Space size={12} align="center" style={{ position: 'relative' }} />

      {/* 居中：Logo */}
      {appConfig?.logoUrl && (
        <img
          src={appConfig.logoUrl}
          alt={appConfig.appName || 'MS'}
          style={{
            height: 28,
            display: 'block',
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        />
      )}

      {/* 右侧占位 */}
      <Space size="middle" align="center" style={{ position: 'relative' }} />
    </Header>
  )
}

export default AppHeader
