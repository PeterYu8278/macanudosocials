/**
 * API 基础封装
 * 提供统一的 API 调用接口和错误处理
 */

import { getAppMessage } from '../../utils/appMessage'
import i18n from '../../i18n'

/**
 * API 响应格式
 */
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * API 错误类型
 */
export type ApiErrorType = 
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR'

/**
 * API 错误类
 */
export class ApiError extends Error {
  type: ApiErrorType
  statusCode?: number
  details?: any

  constructor(
    message: string,
    type: ApiErrorType = 'UNKNOWN_ERROR',
    statusCode?: number,
    details?: any
  ) {
    super(message)
    this.name = 'ApiError'
    this.type = type
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * API 配置
 */
export interface ApiConfig {
  showLoading?: boolean      // 是否显示加载提示
  showError?: boolean         // 是否显示错误提示
  showSuccess?: boolean       // 是否显示成功提示
  successMessage?: string     // 自定义成功提示
  errorMessage?: string       // 自定义错误提示
  timeout?: number            // 超时时间（毫秒）
  retryTimes?: number         // 重试次数
  retryDelay?: number         // 重试延迟（毫秒）
}

/**
 * 默认 API 配置
 */
const DEFAULT_CONFIG: ApiConfig = {
  showLoading: false,
  showError: true,
  showSuccess: false,
  timeout: 30000,
  retryTimes: 0,
  retryDelay: 1000
}

/**
 * 延迟函数
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 统一的 API 调用函数
 * 
 * @example
 * ```tsx
 * // 基础调用
 * const result = await apiCall(async () => {
 *   return await getUserData(userId)
 * })
 * 
 * // 带配置
 * const result = await apiCall(
 *   async () => await updateUser(userId, data),
 *   {
 *     showLoading: true,
 *     showSuccess: true,
 *     successMessage: '更新成功'
 *   }
 * )
 * 
 * // 错误处理
 * const result = await apiCall(
 *   async () => await deleteUser(userId),
 *   { showSuccess: true }
 * )
 * if (!result.success) {
 *   console.error('删除失败:', result.error)
 * }
 * ```
 */
export async function apiCall<T>(
  fn: () => Promise<T>,
  config?: ApiConfig
): Promise<ApiResponse<T>> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }
  const message = getAppMessage()
  let loadingHide: (() => void) | null = null

  try {
    // 显示加载提示
    if (finalConfig.showLoading) {
      loadingHide = message?.loading(i18n.t('common.loading'), 0) || null
    }

    // 执行 API 调用（带重试）
    let lastError: any = null
    let attempt = 0
    const maxAttempts = (finalConfig.retryTimes ?? 0) + 1

    while (attempt < maxAttempts) {
      try {
        // 超时控制
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new ApiError(i18n.t('common.requestTimeout'), 'NETWORK_ERROR')),
              finalConfig.timeout
            )
          )
        ])

        // 隐藏加载提示
        if (loadingHide) {
          loadingHide()
          loadingHide = null
        }

        // 显示成功提示
        if (finalConfig.showSuccess) {
          message?.success(finalConfig.successMessage || i18n.t('common.operationSuccess'))
        }

        return {
          success: true,
          data: result
        }
      } catch (error) {
        lastError = error
        attempt++

        // 如果还有重试次数，等待后重试
        if (attempt < maxAttempts) {
          await delay(finalConfig.retryDelay ?? 1000)
          continue
        }

        throw error
      }
    }

    throw lastError
  } catch (error: any) {
    // 隐藏加载提示
    if (loadingHide) {
      loadingHide()
    }

    // 错误分类
    let apiError: ApiError
    if (error instanceof ApiError) {
      apiError = error
    } else if (error.code === 'permission-denied') {
      apiError = new ApiError(i18n.t('common.noPermission'), 'AUTH_ERROR')
    } else if (error.code === 'not-found') {
      apiError = new ApiError(i18n.t('common.dataNotFound'), 'NOT_FOUND')
    } else if (error.code === 'unavailable') {
      apiError = new ApiError(i18n.t('common.networkError'), 'NETWORK_ERROR')
    } else {
      apiError = new ApiError(
        error.message || i18n.t('common.operationFailed'),
        'UNKNOWN_ERROR',
        undefined,
        error
      )
    }

    // 显示错误提示
    if (finalConfig.showError) {
      message?.error(finalConfig.errorMessage || apiError.message)
    }

    return {
      success: false,
      error: apiError.message
    }
  }
}

/**
 * 批量 API 调用
 * 
 * @example
 * ```tsx
 * const results = await batchApiCall([
 *   () => getUserData(userId1),
 *   () => getUserData(userId2),
 *   () => getUserData(userId3)
 * ])
 * 
 * // 检查结果
 * results.forEach((result, index) => {
 *   if (result.success) {
 *     console.log(`用户 ${index + 1}:`, result.data)
 *   } else {
 *     console.error(`用户 ${index + 1} 加载失败:`, result.error)
 *   }
 * })
 * ```
 */
export async function batchApiCall<T>(
  fns: Array<() => Promise<T>>,
  config?: ApiConfig
): Promise<Array<ApiResponse<T>>> {
  return Promise.all(fns.map(fn => apiCall(fn, config)))
}

/**
 * 并发控制的批量 API 调用
 * 限制同时进行的请求数量
 * 
 * @example
 * ```tsx
 * // 限制最多同时 3 个请求
 * const results = await batchApiCallWithLimit(
 *   [() => fn1(), () => fn2(), () => fn3(), () => fn4(), () => fn5()],
 *   3
 * )
 * ```
 */
export async function batchApiCallWithLimit<T>(
  fns: Array<() => Promise<T>>,
  limit: number,
  config?: ApiConfig
): Promise<Array<ApiResponse<T>>> {
  const results: Array<ApiResponse<T>> = []
  const executing: Array<Promise<void>> = []

  for (const fn of fns) {
    const promise = apiCall(fn, config).then(result => {
      results.push(result)
    })

    executing.push(promise)

    if (executing.length >= limit) {
      await Promise.race(executing)
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      )
    }
  }

  await Promise.all(executing)
  return results
}

/**
 * 防抖 API 调用
 * 在指定时间内多次调用，只执行最后一次
 * 
 * @example
 * ```tsx
 * const debouncedSearch = debounceApiCall(
 *   async (keyword: string) => await searchUsers(keyword),
 *   500
 * )
 * 
 * // 快速连续调用，只会执行最后一次
 * debouncedSearch('test1')
 * debouncedSearch('test2')
 * debouncedSearch('test3') // 只有这次会执行
 * ```
 */
export function debounceApiCall<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: NodeJS.Timeout | null = null

  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return new Promise((resolve, reject) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        fn(...args)
          .then(resolve)
          .catch(reject)
      }, wait)
    })
  }
}

/**
 * 节流 API 调用
 * 在指定时间内最多执行一次
 * 
 * @example
 * ```tsx
 * const throttledUpdate = throttleApiCall(
 *   async (data: any) => await updateData(data),
 *   1000
 * )
 * 
 * // 快速连续调用，每秒最多执行一次
 * throttledUpdate(data1) // 执行
 * throttledUpdate(data2) // 忽略
 * throttledUpdate(data3) // 忽略
 * // 1秒后
 * throttledUpdate(data4) // 执行
 * ```
 */
export function throttleApiCall<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  let lastCall = 0
  let pending: Promise<ReturnType<T>> | null = null

  return (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
    const now = Date.now()

    if (now - lastCall >= wait) {
      lastCall = now
      pending = fn(...args)
      return pending
    }

    return Promise.resolve(null)
  }
}

