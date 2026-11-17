// Cloudinary 配置服务

/**
 * Cloudinary 全局对象类型声明
 */
declare global {
  interface Window {
    cloudinary?: {
      setCloudName: (cloudName: string) => void;
      [key: string]: any;
    };
  }
}

/**
 * Cloudinary 配置接口
 */
export interface CloudinaryConfig {
  cloudName: string
  apiKey: string
  uploadPreset: string
  baseFolder: string
  secure: boolean
}

/**
 * 从环境变量获取 Cloudinary 配置
 */
export const getCloudinaryConfig = (): CloudinaryConfig => {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const apiKey = import.meta.env.VITE_CLOUDINARY_API_KEY
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  const baseFolder = import.meta.env.VITE_CLOUDINARY_BASE_FOLDER
  const secure = true

  if (!cloudName || !apiKey) {
    console.warn('Cloudinary 配置不完整。请检查环境变量 VITE_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_API_KEY')
  }

  return {
    cloudName: cloudName || '',
    apiKey: apiKey || '',
    uploadPreset: uploadPreset || '',
    baseFolder: baseFolder || '',
    secure
  }
}

/**
 * Cloudinary API 端点
 */
export const getCloudinaryApiUrl = (config: CloudinaryConfig, action: string, resourceType: string = 'image'): string => {
  const protocol = config.secure ? 'https' : 'http'
  return `${protocol}://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/${action}`
}

/**
 * Cloudinary 上传 URL
 */
export const getCloudinaryUploadUrl = (config: CloudinaryConfig, resourceType: string = 'image'): string => {
  return getCloudinaryApiUrl(config, 'upload', resourceType)
}

/**
 * Cloudinary 删除 URL
 */
export const getCloudinaryDeleteUrl = (config: CloudinaryConfig, resourceType: string = 'image'): string => {
  return getCloudinaryApiUrl(config, 'destroy', resourceType)
}

/**
 * 生成唯一的文件名
 */
export const generateUniqueFileName = (originalName?: string): string => {
  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 15)
  
  if (originalName) {
    // 提取原始文件名（不含扩展名）
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName
    // 清理文件名（移除特殊字符，只保留字母、数字、连字符和下划线）
    const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
    return `${cleanName}_${timestamp}_${randomStr}`
  }
  
  return `${timestamp}_${randomStr}`
}

/**
 * 验证文件类型
 */
export const isValidFileType = (file: File, allowedFormats: string[]): boolean => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension) return false
  return allowedFormats.includes(extension) || allowedFormats.includes(file.type.split('/')[1]?.toLowerCase())
}

/**
 * 验证文件大小
 */
export const isValidFileSize = (file: File, maxBytes: number): boolean => {
  return file.size <= maxBytes
}

/**
 * 格式化文件大小
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

// Cloudinary 配置（仅用于上传 widget，不含 api_secret）
const cloudinaryConfig = {
  cloud_name: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
  api_key: import.meta.env.VITE_CLOUDINARY_API_KEY,
  secure: true
}

// 动态加载 Cloudinary
const loadCloudinary = async () => {
  if (typeof window !== 'undefined' && !window.cloudinary) {
    const script = document.createElement('script')
    script.src = 'https://widget.cloudinary.com/v2.0/global/all.js'
    script.async = true
    document.head.appendChild(script)
    
    return new Promise((resolve) => {
      script.onload = () => {
        if (window.cloudinary) {
          window.cloudinary.setCloudName(cloudinaryConfig.cloud_name)
          resolve(window.cloudinary)
        } else {
          resolve(null)
        }
      }
    })
  }
  return window.cloudinary || null
}

export { cloudinaryConfig, loadCloudinary }
