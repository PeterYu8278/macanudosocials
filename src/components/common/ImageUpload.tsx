// 图片上传组件
import React, { useState, useRef } from 'react'
import { DeleteOutlined, LoadingOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, App, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { useCloudinary } from '../../hooks/useCloudinary'
import type { UploadResult } from '../../services/cloudinary'
import { deleteResource, extractPublicIdFromUrl } from '../../services/cloudinary'
import { getUploadConfig, getFullFolderPath, isValidFolderName } from '../../config/cloudinaryFolders'
import { validateFileForFolder, type CloudinaryFolderName } from '../../types/cloudinary'
import ImageCrop from './ImageCrop'

interface ImageUploadProps {
  value?: string // 当前图片URL
  onChange?: (url: string | null) => void // 图片变化回调
  folder?: CloudinaryFolderName | string // Cloudinary文件夹名称或自定义路径
  maxSize?: number // 最大文件大小（字节）
  accept?: string // 接受的文件类型
  width?: number | 'auto' // 预览图片宽度
  height?: number | 'auto' // 预览图片高度
  showPreview?: boolean // 是否显示预览
  disabled?: boolean // 是否禁用
  enableCrop?: boolean // 是否启用裁剪功能
  cropAspectRatio?: number // 裁剪宽高比，undefined 表示自由裁剪
  cropMinWidth?: number // 裁剪最小宽度
  cropMinHeight?: number // 裁剪最小高度
  cropMaxWidth?: number // 裁剪最大宽度
  cropMaxHeight?: number // 裁剪最大高度
}

const ImageUpload: React.FC<ImageUploadProps> = ({
  value,
  onChange,
  folder = 'temp',
  maxSize,
  accept = 'image/*',
  width,
  height,
  showPreview = true,
  disabled = false,
  enableCrop = false,
  cropAspectRatio,
  cropMinWidth = 100,
  cropMinHeight = 100,
  cropMaxWidth = 800,
  cropMaxHeight = 800
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { upload, uploading, error } = useCloudinary()
  const [previewVisible, setPreviewVisible] = useState(false)
  const [cropVisible, setCropVisible] = useState(false)
  const [tempImageUrl, setTempImageUrl] = useState<string>('')
  const [tempImageFile, setTempImageFile] = useState<File | null>(null)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 获取文件夹配置
  const folderConfig = isValidFolderName(folder) ? getUploadConfig(folder) : null
  const finalFolder = isValidFolderName(folder) ? getFullFolderPath(folder) : folder
  const finalMaxSize = maxSize || folderConfig?.maxSize || 5 * 1024 * 1024
  const finalWidth = width === 'auto' ? 'auto' : (width || folderConfig?.width || 120)
  const finalHeight = height === 'auto' ? 'auto' : (height || folderConfig?.height || 120)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 使用新的验证逻辑
    if (isValidFolderName(folder)) {
      const validation = validateFileForFolder(file, folder)
      if (!validation.valid) {
        message.error(validation.error)
        return
      }
    } else {
      // 自定义文件夹的验证
      if (file.size > finalMaxSize) {
        message.error(t('upload.fileTooLarge', { size: Math.floor(finalMaxSize / 1024 / 1024) }))
        return
      }

      if (!file.type.startsWith('image/')) {
        message.error(t('upload.selectImageFile'))
        return
      }
    }

    // 如果启用裁剪功能，先显示裁剪界面
    if (enableCrop) {
      const imageUrl = URL.createObjectURL(file)
      setTempImageUrl(imageUrl)
      setTempImageFile(file) // 保存原始文件以便后续检测格式
      setCropVisible(true)
    } else {
      // 直接上传
      try {
        // 检测文件格式，明确指定格式以保持 PNG 透明背景
        const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
        const result: UploadResult = await upload(file, {
          folder: finalFolder,
          format: isPng ? 'png' : 'jpg' // 明确指定格式，防止 Cloudinary 自动转换
        })
        
        onChange?.(result.secure_url)
        message.success(t('upload.success'))
      } catch (err) {
        message.error(t('upload.fail'))
      }
    }

    // 清空input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 处理裁剪完成
  const handleCropComplete = async (croppedImageUrl: string) => {
    try {
      // 将裁剪后的图片 URL 转换为 File 对象
      const response = await fetch(croppedImageUrl)
      const blob = await response.blob()
      
      // 检测原始文件格式，保持 PNG 透明背景
      const originalFile = tempImageFile
      const isPng = originalFile?.type === 'image/png' || originalFile?.name.toLowerCase().endsWith('.png')
      const fileExtension = isPng ? 'png' : 'jpg'
      // 使用 blob 的实际类型，如果 blob 是 PNG 则保持 PNG，否则使用检测到的类型
      const blobType = blob.type || (isPng ? 'image/png' : 'image/jpeg')
      const mimeType = isPng ? 'image/png' : 'image/jpeg'
      const fileName = `cropped-image_${Date.now()}.${fileExtension}`
      
      // 确保 File 对象的类型与 blob 的实际类型一致
      const file = new File([blob], fileName, { type: blobType || mimeType })

      // 上传裁剪后的图片，明确指定格式以保持 PNG 透明背景
      const result: UploadResult = await upload(file, {
        folder: finalFolder,
        format: isPng ? 'png' : 'jpg' // 明确指定格式，防止 Cloudinary 自动转换
      })
      
      // 验证上传结果
      if (!result?.secure_url) {
        throw new Error('上传失败：未返回有效的图片 URL')
      }
      
      onChange?.(result.secure_url)
      message.success(t('upload.success'))
      
      // 清理临时 URL
      URL.revokeObjectURL(croppedImageUrl)
      URL.revokeObjectURL(tempImageUrl)
      setCropVisible(false)
      setTempImageUrl('')
      setTempImageFile(null)
    } catch (err) {
      console.error('上传裁剪后的图片失败:', err)
      message.error(t('upload.fail'))
    }
  }

  // 处理裁剪取消
  const handleCropCancel = () => {
    // 清理临时 URL
    if (tempImageUrl) {
      URL.revokeObjectURL(tempImageUrl)
    }
    setCropVisible(false)
    setTempImageUrl('')
    setTempImageFile(null)
  }

  const handleDelete = () => {
    setDeleteConfirmVisible(true)
  }

  const handleDeleteConfirm = async () => {
    if (!value) {
      setDeleteConfirmVisible(false)
      return
    }

    setDeleting(true)
    try {
      // 从 URL 中提取 public_id
      const publicId = extractPublicIdFromUrl(value)
      
      if (publicId) {
        // 调用 Cloudinary API 删除文件
        await deleteResource(publicId, {
          resourceType: 'image',
          invalidate: true // 同时从 CDN 缓存中删除
        })
        message.success(t('upload.imageDeleted'))
      } else {
        // 如果无法提取 public_id，仅从表单中移除 URL
        message.warning(t('upload.unableToDeleteFromCloudinary'))
      }

      // 无论是否成功删除 Cloudinary 文件，都从表单中移除 URL
      onChange?.(null)
      setDeleteConfirmVisible(false)
    } catch (error: any) {
      console.error('删除 Cloudinary 文件失败:', error)
      // 即使 Cloudinary 删除失败，也从表单中移除 URL
      onChange?.(null)
      message.warning(error?.message || t('upload.deleteFailed'))
      setDeleteConfirmVisible(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteCancel = () => {
    setDeleteConfirmVisible(false)
  }

  const handlePreview = () => {
    setPreviewVisible(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      {/* 图片预览区域 */}
      {value ? (
        <div style={{ position: 'relative' }}>
          <img
            src={value}
            alt="预览"
            style={{
              width: finalWidth === 'auto' ? 'auto' : `${finalWidth}px`,
              height: finalHeight === 'auto' ? 'auto' : `${finalHeight}px`,
              maxWidth: finalWidth === 'auto' ? '200px' : undefined,
              maxHeight: finalHeight === 'auto' ? '200px' : undefined,
              objectFit: 'contain',
              borderRadius: '8px',
              border: folder === 'app-config' ? '2px solid #ffd700' : '1px solid rgba(255, 215, 0, 0.3)',
              cursor: showPreview ? 'pointer' : 'default',
              boxShadow: folder === 'app-config' ? '0 4px 12px rgba(255, 215, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.15)'
            }}
            onClick={showPreview ? handlePreview : undefined}
          />
          
          {/* 删除按钮 */}
          {!disabled && (
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              size="small"
              style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                minWidth: '24px',
                height: '24px',
                borderRadius: '50%',
                background: folder === 'app-config' ? 'rgba(15, 15, 15, 0.9)' : '#fff',
                border: folder === 'app-config' ? '1px solid #ffd700' : 'none',
                color: folder === 'app-config' ? '#ffd700' : undefined,
                boxShadow: folder === 'app-config' ? '0 2px 8px rgba(255, 215, 0, 0.3)' : '0 2px 8px rgba(0,0,0,0.15)'
              }}
              onClick={handleDelete}
            />
          )}
        </div>
      ) : (
        <div
          style={{
            width: finalWidth === 'auto' ? 'auto' : `${finalWidth}px`,
            height: finalHeight === 'auto' ? 'auto' : `${finalHeight}px`,
            minWidth: finalWidth === 'auto' ? '120px' : undefined,
            minHeight: finalHeight === 'auto' ? '120px' : undefined,
            maxWidth: finalWidth === 'auto' ? '200px' : undefined,
            maxHeight: finalHeight === 'auto' ? '200px' : undefined,
            border: folder === 'app-config' ? '2px dashed #ffd700' : '2px dashed rgba(255, 215, 0, 0.3)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: folder === 'app-config' ? 'rgba(15, 15, 15, 0.5)' : 'rgba(26, 26, 26, 0.3)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            transition: 'all 0.3s ease'
          }}
          onClick={() => !disabled && fileInputRef.current?.click()}
          onMouseEnter={(e) => {
            if (!disabled && folder === 'app-config') {
              e.currentTarget.style.borderColor = '#ffd700'
              e.currentTarget.style.background = 'rgba(15, 15, 15, 0.7)'
            }
          }}
          onMouseLeave={(e) => {
            if (folder === 'app-config') {
              e.currentTarget.style.borderColor = '#ffd700'
              e.currentTarget.style.background = 'rgba(15, 15, 15, 0.5)'
            }
          }}
        >
          {uploading ? (
            <LoadingOutlined style={{ fontSize: '24px', color: folder === 'app-config' ? '#ffd700' : '#1890ff' }} />
          ) : (
            <PlusOutlined style={{ fontSize: '24px', color: folder === 'app-config' ? '#ffd700' : '#999' }} />
          )}
          <div style={{ marginTop: '8px', fontSize: '12px', color: folder === 'app-config' ? '#ffd700' : '#999' }}>
            {uploading ? t('upload.uploading') : t('upload.clickToUpload')}
          </div>
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        disabled={disabled}
      />

      {/* 错误信息 */}
      {error && (
        <div style={{ color: '#ff4d4f', fontSize: '12px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* 图片预览模态框 */}
      <Modal
        open={previewVisible}
        title={<span style={{ color: '#ffd700', fontWeight: 600 }}>{t('upload.imagePreview')}</span>}
        footer={null}
        onCancel={() => setPreviewVisible(false)}
        width="auto"
        style={{
          background: 'rgba(15, 15, 15, 0.95)'
        }}
        styles={{
          content: {
            background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '8px'
          },
          header: {
            background: 'rgba(15, 15, 15, 0.8)',
            borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
            borderRadius: '8px 8px 0 0'
          }
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'rgba(15, 15, 15, 0.5)',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <img
            src={value}
            alt="预览"
            style={{
              maxWidth: '100%',
              maxHeight: '80vh',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(255, 215, 0, 0.2)'
            }}
          />
        </div>
      </Modal>

      {/* 删除确认对话框 */}
      <Modal
        open={deleteConfirmVisible}
        title={t('common.confirmDelete')}
        onOk={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        okText={t('common.delete')}
        okButtonProps={{ danger: true, loading: deleting }}
        cancelText={t('common.cancel')}
        confirmLoading={deleting}
      >
        <p>{t('upload.confirmDeleteImage')}</p>
      </Modal>

      {/* 图片裁剪对话框 */}
      {enableCrop && (
        <ImageCrop
          src={tempImageUrl}
          visible={cropVisible}
          onCancel={handleCropCancel}
          onConfirm={handleCropComplete}
          aspectRatio={cropAspectRatio}
          minWidth={cropMinWidth}
          minHeight={cropMinHeight}
          maxWidth={cropMaxWidth}
          maxHeight={cropMaxHeight}
          title={t('upload.cropImage', { defaultValue: '图片裁剪' })}
          originalFileType={tempImageFile?.type}
        />
      )}
    </div>
  )
}

export default ImageUpload
