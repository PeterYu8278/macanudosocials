/**
 * 认证相关 Hook
 * 提供统一的认证逻辑访问接口
 */

import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/modules/auth'
import { getUserData, loginUser, registerUser } from '../services/firebase/auth'
import { signOut } from 'firebase/auth'
import { auth } from '../config/firebase'
import { AUTH_ROUTES } from '../constants/routes'
import type { User, UserRole } from '../types'
import { App } from 'antd'
import i18n from '../i18n'

/**
 * 认证状态和操作
 */
export interface UseAuthReturn {
  /** 当前用户 */
  user: User | null
  /** Firebase 用户对象 */
  firebaseUser: any | null
  /** 是否加载中 */
  loading: boolean
  /** 错误信息 */
  error: string | null
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 是否为管理员 */
  isAdmin: boolean
  /** 用户角色 */
  role: UserRole | null
  /** 用户 ID */
  userId: string | null
  /** 用户名 */
  username: string | null
  /** 用户邮箱 */
  email: string | null
  
  /** 登录 */
  login: (email: string, password: string) => Promise<void>
  /** 注册 */
  register: (email: string, password: string, userData: Partial<User>) => Promise<void>
  /** 登出 */
  logout: () => Promise<void>
  /** 刷新用户数据 */
  refreshUser: () => Promise<void>
  /** 检查权限 */
  checkPermission: (permission: string) => boolean
}

/**
 * 认证 Hook
 * 
 * @example
 * ```tsx
 * const { user, isAuthenticated, isAdmin, login, logout } = useAuth()
 * 
 * // 登录
 * const handleLogin = async () => {
 *   try {
 *     await login('user@example.com', 'password123')
 *     message.success('登录成功')
 *   } catch (error) {
 *     message.error('登录失败')
 *   }
 * }
 * 
 * // 登出
 * const handleLogout = async () => {
 *   await logout()
 *   message.success('已登出')
 * }
 * 
 * // 检查管理员权限
 * if (isAdmin) {
 *   // 显示管理员功能
 * }
 * ```
 */
export const useAuth = (): UseAuthReturn => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  
  const {
    user,
    firebaseUser,
    loading,
    error,
    isAdmin,
    setLoading,
    setError,
    logout: logoutStore,
    hasPermission
  } = useAuthStore()

  // 是否已登录
  const isAuthenticated = !!user

  // 用户角色
  const role = user?.role ?? null

  // 用户 ID
  const userId = user?.id ?? null

  // 用户名
  const username = user?.displayName ?? null

  // 用户邮箱
  const email = user?.email ?? firebaseUser?.email ?? null

  /**
   * 登录
   */
  const login = async (email: string, password: string): Promise<void> => {
    try {
      setLoading(true)
      setError(null)
      
      await loginUser(email, password)
      
      // 认证状态会由 onAuthStateChange 自动更新
      // 等待一小段时间确保状态更新
      await new Promise(resolve => setTimeout(resolve, 500))
      
      message.success(i18n.t('auth.loginSuccess'))
      navigate('/')
    } catch (error: any) {
      const errorMessage = error.message || i18n.t('auth.loginFailed')
      setError(errorMessage)
      message.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
    }
  }

  /**
   * 注册
   */
  const register = async (
    email: string,
    password: string,
    userData: Partial<User>
  ): Promise<void> => {
    try {
      setLoading(true)
      setError(null)
      
      await registerUser(email, password, userData.displayName || '', userData.profile?.phone || '')
      
      // 认证状态会由 onAuthStateChange 自动更新
      await new Promise(resolve => setTimeout(resolve, 500))
      
      message.success(i18n.t('auth.registerSuccess'))
      navigate('/')
    } catch (error: any) {
      const errorMessage = error.message || i18n.t('auth.registerFailed')
      setError(errorMessage)
      message.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
    }
  }

  /**
   * 登出
   */
  const logout = async (): Promise<void> => {
    try {
      setLoading(true)
      
      await signOut(auth)
      logoutStore()
      
      message.success(i18n.t('auth.loggedOut'))
      navigate(AUTH_ROUTES.LOGIN)
    } catch (error: any) {
      const errorMessage = error.message || i18n.t('auth.logoutFailed')
      message.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
    }
  }

  /**
   * 刷新用户数据
   */
  const refreshUser = async (): Promise<void> => {
    if (!firebaseUser) {
      throw new Error(i18n.t('auth.notLoggedIn'))
    }

    try {
      setLoading(true)
      
      // 重新获取用户数据
      const userData = await getUserData(firebaseUser.uid)
      
      if (userData) {
        useAuthStore.getState().setUser(userData)
        message.success(i18n.t('auth.userDataRefreshed'))
      }
    } catch (error: any) {
      const errorMessage = error.message || i18n.t('auth.refreshFailed')
      message.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
    }
  }

  /**
   * 检查权限
   */
  const checkPermission = (permission: string): boolean => {
    return hasPermission(permission as any)
  }

  return {
    user,
    firebaseUser,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    role,
    userId,
    username,
    email,
    login,
    register,
    logout,
    refreshUser,
    checkPermission
  }
}

/**
 * 要求已登录的 Hook
 * 如果未登录，自动跳转到登录页
 * 
 * @example
 * ```tsx
 * const MyPage = () => {
 *   const auth = useRequireAuth()
 *   
 *   if (auth.loading) {
 *     return <LoadingSpinner />
 *   }
 *   
 *   return <div>Welcome {auth.username}</div>
 * }
 * ```
 */
export const useRequireAuth = (): UseAuthReturn => {
  const auth = useAuth()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      message.warning(i18n.t('auth.pleaseLogin'))
      navigate(AUTH_ROUTES.LOGIN)
    }
  }, [auth.loading, auth.isAuthenticated, navigate])

  return auth
}

/**
 * 要求管理员权限的 Hook
 * 如果不是管理员，自动跳转到首页
 * 
 * @example
 * ```tsx
 * const AdminPage = () => {
 *   const auth = useRequireAdmin()
 *   
 *   if (auth.loading) {
 *     return <LoadingSpinner />
 *   }
 *   
 *   return <div>Admin Panel</div>
 * }
 * ```
 */
export const useRequireAdmin = (): UseAuthReturn => {
  const auth = useAuth()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!auth.loading) {
      if (!auth.isAuthenticated) {
        message.warning(i18n.t('auth.pleaseLogin'))
        navigate(AUTH_ROUTES.LOGIN)
      } else if (!auth.isAdmin) {
        message.error(i18n.t('auth.noAdminPermission'))
        navigate('/')
      }
    }
  }, [auth.loading, auth.isAuthenticated, auth.isAdmin, navigate])

  return auth
}

// 需要 React 引用
import React from 'react'

