import React from 'react'
import { Button, App } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

interface BatchDeleteButtonProps {
  /** 选中的项目ID列表 */
  selectedIds: React.Key[]
  /** 批量删除确认对话框的标题 */
  confirmTitle?: string
  /** 批量删除确认对话框的内容 */
  confirmContent?: string
  /** 删除成功后的回调 */
  onSuccess?: () => void
  /** 删除失败后的回调 */
  onError?: (error: Error) => void
  /** 批量删除函数 */
  onBatchDelete: (ids: string[]) => Promise<{ success: boolean; error?: string | Error }>
  /** 按钮大小 */
  size?: 'small' | 'middle' | 'large'
  /** 按钮类型 */
  type?: 'default' | 'primary' | 'dashed' | 'text'
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
  /** 项目类型名称（用于确认对话框） */
  itemTypeName?: string
}

const BatchDeleteButton: React.FC<BatchDeleteButtonProps> = ({
  selectedIds,
  confirmTitle,
  confirmContent,
  onSuccess,
  onError,
  onBatchDelete,
  size = 'middle',
  type = 'default',
  danger = true,
  disabled = false,
  style,
  buttonText,
  showIcon = true,
  loading = false,
  itemTypeName = '项目'
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const handleBatchDelete = async () => {
    
    const defaultTitle = confirmTitle || t('common.batchDeleteConfirm')
    const defaultContent = confirmContent || `确定要删除选中的 ${selectedIds.length} 个${itemTypeName}吗？`
    
    const confirmed = window.confirm(`${defaultTitle}\n\n${defaultContent}`)
    
    if (confirmed) {
      try {
        
        const result = await onBatchDelete(selectedIds.map(id => String(id)))
        
        if (result.success) {
          message.success(t('common.batchDeleted'))
          onSuccess?.()
        } else {
          const errorMessage = result.error instanceof Error ? result.error.message : result.error || 'Unknown error'
          message.error(t('common.batchDeleteFailed') + ': ' + errorMessage)
          onError?.(new Error(errorMessage))
        }
      } catch (error) {
        message.error(t('common.batchDeleteFailed') + ': ' + (error as Error).message)
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
      disabled={disabled || loading || selectedIds.length === 0}
      loading={loading}
      onClick={handleBatchDelete}
      style={style}
    >
      {buttonText || t('common.batchDelete')}
    </Button>
  )
}

export default BatchDeleteButton
