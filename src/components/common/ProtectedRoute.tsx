// 路由权限保护组件
import React, { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Spin, Result, Button, message } from 'antd'
import { useAuthStore } from '../../store/modules/auth'
import type { UserRole } from '../../types'
import { canAccessRoute } from '../../config/permissions'
import { useTranslation } from 'react-i18next'
import { isFeatureVisible } from '../../services/firebase/featureVisibility'
import { getFeatureKeyByRoute } from '../../config/featureDefinitions'

interface ProtectedRouteProps {
  children: React.ReactNode
  roles?: UserRole[]
  requireAuth?: boolean
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  roles = ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'],
  requireAuth = true 
}) => {
  const { user, loading } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [featureVisible, setFeatureVisible] = useState<boolean | null>(null)
  const [checkingFeature, setCheckingFeature] = useState(false)

  // 检查功能可见性
  useEffect(() => {
    const checkFeatureVisibility = async () => {
      const featureKey = getFeatureKeyByRoute(location.pathname)
      
      if (featureKey) {
        setCheckingFeature(true)
        const visible = await isFeatureVisible(featureKey)
        setFeatureVisible(visible)
        setCheckingFeature(false)
      } else {
        // 如果没有对应的功能键，默认可见
        setFeatureVisible(true)
      }
    }
    
    if (!loading && user) {
      checkFeatureVisibility()
    } else {
      // 如果未登录，也设置 featureVisible 为 true，避免一直 loading
      if (!loading && !user) {
        setFeatureVisible(true)
      }
    }
  }, [location.pathname, loading, user])

  // 处理未登录的情况
  useEffect(() => {
    if (!loading && requireAuth && !user) {
      message.info(t('auth.pleaseLogin'))
    }
  }, [loading, requireAuth, user, t])

  // 加载中状态或检查功能可见性中
  if (loading || checkingFeature || featureVisible === null) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spin size="large" />
      </div>
    )
  }

  // 功能不可见（仅对已登录用户检查，开发者不受限制）
  if (user && user.role !== 'developer' && featureVisible === false) {
    return (
      <Result
        status="404"
        title="404"
        subTitle={t('messages.featureNotAvailable', { defaultValue: '该功能暂不可用' })}
        extra={
          <Button type="primary" onClick={() => navigate('/')} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#221c10' }}>
            {t('common.back')}
          </Button>
        }
      />
    )
  }

  // 需要认证但未登录
  if (requireAuth && !user) {
    return <Navigate to="/" replace />
  }

  // 已登录但资料不完整（缺少名字、电邮或手机号）
  // 排除完善资料页面本身，避免重定向循环
  const isProfileIncomplete = !user?.displayName || !user?.email || !user?.profile?.phone
  
  if (user && isProfileIncomplete && location.pathname !== '/auth/complete-profile') {
    message.warning(t('auth.completeProfileWarning'))
    return <Navigate to="/auth/complete-profile" state={{ from: location }} replace />
  }

  // 已登录但角色权限不足
  if (user && !canAccessRoute(user.role, location.pathname)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle={t('messages.accessDenied')}
        extra={
          <Button type="primary" onClick={() => window.history.back()} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#221c10' }}>
            {t('common.back')}
          </Button>
        }
      />
    )
  }

  // 角色权限检查
  if (user && roles.length > 0 && !roles.includes(user.role)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle={t('messages.noPermission')}
        extra={
          <Button type="primary" onClick={() => window.history.back()} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#221c10' }}>
            {t('common.back')}
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}

export default ProtectedRoute
