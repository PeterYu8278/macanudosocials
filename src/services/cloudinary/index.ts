// Cloudinary 服务统一导出

// 类型定义
export type {
  ResourceType,
  CloudinaryResource,
  TransformationOptions,
  DeleteOptions,
  DeleteResult,
  BulkDeleteOptions,
  BulkDeleteResult,
  ListResourcesOptions,
  ListResourcesResult,
  GetResourceOptions,
  UpdateResourceOptions,
  RenameResourceOptions,
  UrlOptions,
  ValidationResult
} from './types'

export { CloudinaryError } from './types'

// 配置
export { getCloudinaryConfig } from './config'

// Create 服务
export {
  uploadFile,
  uploadBase64,
  validateUploadFile
} from './create'

// Read 服务
export {
  getResource,
  listResources,
  checkResourceExists,
  getResourceUrl,
  parseResourceFromUrl,
  extractPublicIdFromUrl
} from './read'

// Update 服务
export {
  updateResource,
  renameResource,
  transformResource,
  addTagsToResource,
  removeTagsFromResource,
  setResourceContext
} from './update'

// Delete 服务
export {
  deleteResource,
  deleteResources,
  deleteFolder
} from './delete'

// URL 生成服务
export {
  generateUrl,
  getOptimizedImageUrl,
  getThumbnailUrl,
  getBrandLogoUrl,
  getProductImageUrl,
  getEventImageUrl,
  getUserAvatarUrl
} from './url'

// 向后兼容：导出旧的接口
export type { UploadResult, UploadOptionsOld } from './types'

// 导出 UploadOptions 类型别名（保持向后兼容）
export type { UploadOptions } from './types'
