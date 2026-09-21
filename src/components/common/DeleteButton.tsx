import React from 'react'
import { Button, App } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

interface DeleteButtonProps {
  /** 要删除的项目ID */
  itemId: string
  /** 要删除的项目名称（用于确认对话框） */
  itemName?: string
  /** 删除确认对话框的标题 */
  confirmTitle?: string
  /** 删除确认对话框的内容 */
  confirmContent?: string
  /** 删除成功后的回调 */
  onSuccess?: () => void
  /** 删除失败后的回调 */
  onError?: (error: Error) => void
  /** 删除函数 */
  onDelete: (id: string) => Promise<{ success: boolean; error?: string | Error }>
  /** 按钮大小 */
  size?: 'small' | 'middle' | 'large'
  /** 按钮类型 */
  type?: 'link' | 'default' | 'primary' | 'dashed' | 'text'
  /** 是否显示危险样式 */
  danger?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义样式 */
  style?: React.CSSProperties
  /** 按钮文本 */
  buttonText?: string
  /** 是否显示图标 */
  showIcon?: boolean
  /** 加载状态 */
  loading?: boolean
}

const DeleteButton: React.FC<DeleteButtonProps> = ({
  itemId,
  itemName,
  confirmTitle,
  confirmContent,
  onSuccess,
  onError,
  onDelete,
  size = 'small',
  type = 'link',
  danger = true,
  disabled = false,
  style,
  buttonText,
  showIcon = true,
  loading = false
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const handleDelete = async () => {
    
    const defaultTitle = confirmTitle || t('common.deleteConfirm')
    const defaultContent = confirmContent || `确定要删除${itemName ? ` "${itemName}"` : ''}吗？`
    
    const confirmed = window.confirm(`${defaultTitle}\n\n${defaultContent}`)
    
    if (confirmed) {
      try {
        const result = await onDelete(itemId)
        
        if (result.success) {
          message.success(t('common.deleted'))
          onSuccess?.()
        } else {
          const errorMessage = result.error instanceof Error ? result.error.message : result.error || 'Unknown error'
          message.error(t('common.deleteFailed') + ': ' + errorMessage)
          onError?.(new Error(errorMessage))
        }
      } catch (error) {
        message.error(t('common.deleteFailed') + ': ' + (error as Error).message)
        onError?.(error as Error)
      }
    } else {
    }
  }

  return (
    <Button
      type={type}
      danger={danger}
      icon={showIcon ? <DeleteOutlined /> : undefined}
      size={size}
      disabled={disabled || loading}
      loading={loading}
      onClick={handleDelete}
      style={style}
    >
    </Button>
  )
}

export default DeleteButton
