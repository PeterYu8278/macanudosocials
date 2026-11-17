import { auth } from '../../config/firebase'
import type { DeleteOptions, DeleteResult, BulkDeleteOptions, BulkDeleteResult } from './types'
import { CloudinaryError } from './types'

/**
 * 删除单个资源（通过 Netlify Function 服务端签名，API Secret 不暴露给浏览器）
 */
export const deleteResource = async (
  publicId: string,
  options: DeleteOptions = {}
): Promise<DeleteResult> => {
  if (!publicId) {
    throw new CloudinaryError('public_id 不能为空', 'INVALID_PUBLIC_ID', 400)
  }

  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new CloudinaryError('删除资源需要登录', 'UNAUTHENTICATED', 401)
  }

  const idToken = await currentUser.getIdToken()

  const response = await fetch('/.netlify/functions/cloudinary-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      publicId,
      resourceType: options.resourceType || 'image',
      invalidate: options.invalidate,
    }),
  })

  const result = await response.json().catch(() => ({})) as {
    success?: boolean
    result?: string
    error?: string
    public_id?: string
  }

  if (!response.ok || !result.success) {
    throw new CloudinaryError(result.error || '删除失败', 'DELETE_ERROR', response.status)
  }

  if (result.result === 'not found') {
    return { result: 'not found', public_id: publicId }
  }

  return { result: 'ok', public_id: result.public_id || publicId }
}

/**
 * 批量删除资源（需服务端实现）
 */
export const deleteResources = async (
  _options: BulkDeleteOptions
): Promise<BulkDeleteResult> => {
  throw new CloudinaryError(
    'deleteResources 功能需要在服务器端实现。请通过后端 API 代理删除请求。',
    'NOT_SUPPORTED_IN_BROWSER',
    501
  )
}

/**
 * 删除文件夹（需服务端实现）
 */
export const deleteFolder = async (
  _folderPath: string,
  _options: DeleteOptions = {}
): Promise<DeleteResult> => {
  throw new CloudinaryError(
    'deleteFolder 功能需要在服务器端实现。请通过后端 API 代理删除请求。',
    'NOT_SUPPORTED_IN_BROWSER',
    501
  )
}
