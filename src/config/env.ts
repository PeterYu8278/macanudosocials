/**
 * 环境配置管理
 * 统一管理所有环境变量和配置
 */

// 环境类型
export type Environment = 'development' | 'staging' | 'production'

// 应用配置接口
export interface AppConfig {
  // 环境信息
  env: Environment
  isDev: boolean
  isProd: boolean
  isStaging: boolean
  
  // API 配置
  api: {
    baseUrl: string
    timeout: number
    retryAttempts: number
  }
  
  // Firebase 配置
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
  }
  
  // Cloudinary 配置
  cloudinary: {
    cloudName: string
    apiKey: string
    apiSecret: string
  }
  
  // 应用信息
  app: {
    name: string
    version: string
    description: string
    author: string
  }
  
  // 功能开关
  features: {
    analytics: boolean
    notifications: boolean
    pwa: boolean
    offline: boolean
    debug: boolean
  }
  
  // UI 配置
  ui: {
    theme: 'dark' | 'light'
    language: 'zh-CN' | 'en-US'
    pageSize: number
    maxFileSize: number
  }
  
  // 安全配置
  security: {
    enableCSP: boolean
    enableHSTS: boolean
    sessionTimeout: number
  }
}

// 默认配置
const defaultConfig: AppConfig = {
  env: 'development',
  isDev: true,
  isProd: false,
  isStaging: false,
  
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 30000,
    retryAttempts: 3
  },
  
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  },
  
  cloudinary: {
    cloudName: '',
    apiKey: '',
    apiSecret: ''
  },
  
  app: {
    name: 'MS',
    version: '1.0.0',
    description: 'Macanudo Socials Management Platform',
    author: 'JEP Ventures'
  },
  
  features: {
    analytics: false,
    notifications: true,
    pwa: true,
    offline: false,
    debug: false
  },
  
  ui: {
    theme: 'dark',
    language: 'zh-CN',
    pageSize: 10,
    maxFileSize: 10 * 1024 * 1024 // 10MB
  },
  
  security: {
    enableCSP: true,
    enableHSTS: true,
    sessionTimeout: 30 * 60 * 1000 // 30分钟
  }
}

// 环境变量映射
const envVarMap: Record<string, string> = {
  // 环境
  'VITE_ENV': 'env',
  
  // API
  'VITE_API_BASE_URL': 'api.baseUrl',
  'VITE_API_TIMEOUT': 'api.timeout',
  'VITE_API_RETRY_ATTEMPTS': 'api.retryAttempts',
  
  // Firebase
  'VITE_FIREBASE_API_KEY': 'firebase.apiKey',
  'VITE_FIREBASE_AUTH_DOMAIN': 'firebase.authDomain',
  'VITE_FIREBASE_PROJECT_ID': 'firebase.projectId',
  'VITE_FIREBASE_STORAGE_BUCKET': 'firebase.storageBucket',
  'VITE_FIREBASE_MESSAGING_SENDER_ID': 'firebase.messagingSenderId',
  'VITE_FIREBASE_APP_ID': 'firebase.appId',
  
  // Cloudinary
  'VITE_CLOUDINARY_CLOUD_NAME': 'cloudinary.cloudName',
  'VITE_CLOUDINARY_API_KEY': 'cloudinary.apiKey',
  'VITE_CLOUDINARY_API_SECRET': 'cloudinary.apiSecret',
  
  // 应用信息
  'VITE_APP_NAME': 'app.name',
  'VITE_APP_VERSION': 'app.version',
  'VITE_APP_DESCRIPTION': 'app.description',
  'VITE_APP_AUTHOR': 'app.author',
  
  // 功能开关
  'VITE_FEATURE_ANALYTICS': 'features.analytics',
  'VITE_FEATURE_NOTIFICATIONS': 'features.notifications',
  'VITE_FEATURE_PWA': 'features.pwa',
  'VITE_FEATURE_OFFLINE': 'features.offline',
  'VITE_FEATURE_DEBUG': 'features.debug',
  
  // UI
  'VITE_UI_THEME': 'ui.theme',
  'VITE_UI_LANGUAGE': 'ui.language',
  'VITE_UI_PAGE_SIZE': 'ui.pageSize',
  'VITE_UI_MAX_FILE_SIZE': 'ui.maxFileSize',
  
  // 安全
  'VITE_SECURITY_ENABLE_CSP': 'security.enableCSP',
  'VITE_SECURITY_ENABLE_HSTS': 'security.enableHSTS',
  'VITE_SECURITY_SESSION_TIMEOUT': 'security.sessionTimeout'
}

// 类型转换函数
const typeConverters = {
  string: (value: string) => value,
  number: (value: string) => Number(value),
  boolean: (value: string) => value === 'true',
  json: (value: string) => JSON.parse(value)
}

// 设置嵌套属性值
const setNestedValue = (obj: any, path: string, value: any) => {
  const keys = path.split('.')
  let current = obj
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key]
  }
  
  current[keys[keys.length - 1]] = value
}

// 获取嵌套属性值
const getNestedValue = (obj: any, path: string) => {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

// 解析环境变量
const parseEnvVars = (): Partial<AppConfig> => {
  const config: any = {}
  
  Object.entries(envVarMap).forEach(([envVar, configPath]) => {
    const value = import.meta.env[envVar]
    
    if (value !== undefined) {
      let convertedValue = value
      
      // 类型转换
      if (value === 'true' || value === 'false') {
        convertedValue = typeConverters.boolean(value)
      } else if (!isNaN(Number(value))) {
        convertedValue = typeConverters.number(value)
      } else if (value.startsWith('{') || value.startsWith('[')) {
        try {
          convertedValue = typeConverters.json(value)
        } catch {
          // 如果 JSON 解析失败，保持原值
        }
      }
      
      setNestedValue(config, configPath, convertedValue)
    }
  })
  
  return config
}

// 合并配置
const mergeConfig = (defaultConfig: AppConfig, envConfig: Partial<AppConfig>): AppConfig => {
  const merged = { ...defaultConfig }
  
  // 递归合并对象
  const deepMerge = (target: any, source: any) => {
    Object.keys(source).forEach(key => {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {}
        deepMerge(target[key], source[key])
      } else {
        target[key] = source[key]
      }
    })
  }
  
  deepMerge(merged, envConfig)
  
  // 设置环境标志
  merged.isDev = merged.env === 'development'
  merged.isProd = merged.env === 'production'
  merged.isStaging = merged.env === 'staging'
  
  return merged
}

// 创建配置实例
const createConfig = (): AppConfig => {
  const envConfig = parseEnvVars()
  return mergeConfig(defaultConfig, envConfig)
}

// 配置实例
export const config = createConfig()

// 配置验证
export const validateConfig = (): { valid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  // 验证必需的环境变量
  const requiredVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_CLOUDINARY_CLOUD_NAME'
  ]
  
  requiredVars.forEach(varName => {
    if (!import.meta.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`)
    }
  })
  
  // 验证配置值
  if (config.api.timeout <= 0) {
    errors.push('API timeout must be greater than 0')
  }
  
  if (config.ui.pageSize <= 0) {
    errors.push('Page size must be greater than 0')
  }
  
  if (config.ui.maxFileSize <= 0) {
    errors.push('Max file size must be greater than 0')
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

// 配置更新函数
export const updateConfig = (updates: Partial<AppConfig>): AppConfig => {
  Object.assign(config, updates)
  
  // 更新环境标志
  config.isDev = config.env === 'development'
  config.isProd = config.env === 'production'
  config.isStaging = config.env === 'staging'
  
  return config
}

// 配置重置函数
export const resetConfig = (): AppConfig => {
  Object.assign(config, defaultConfig)
  return config
}

// 获取配置值
export const getConfigValue = <T = any>(path: string): T => {
  return getNestedValue(config, path)
}

// 设置配置值
export const setConfigValue = <T = any>(path: string, value: T): void => {
  setNestedValue(config, path, value)
}

// 导出配置
export default config
