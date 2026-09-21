// 替代约 15 个视图中重复的 Modal.confirm 删除确认模式

import { useCallback } from 'react'
import { Modal, App } from 'antd'
import i18n from '../i18n'

interface UseDeleteConfirmOptions {
  title?: string
  content?: string
  successMessage?: string
  errorMessage?: string
  onSuccess?: () => void
}

interface UseDeleteConfirmResult {
  confirmDelete: (id: string) => void
}

/**
 * 通用删除确认 Hook
 *
 * 用法：
 *   const { confirmDelete } = useDeleteConfirm({
 *     onConfirm: (id) => deleteUser(id),
 *     onSuccess: refresh,
 *   })
 *
 *   <Button danger onClick={() => confirmDelete(record.id)}>删除</Button>
 */
export function useDeleteConfirm(
  onConfirm: (id: string) => Promise<{ success: boolean; error?: unknown }>,
  options: UseDeleteConfirmOptions = {}
): UseDeleteConfirmResult {
  const { message } = App.useApp()
  const {
    title = i18n.t('common.confirmDelete'),
    content = i18n.t('common.irreversibleConfirm'),
    successMessage = i18n.t('common.deleteSuccess'),
    errorMessage = i18n.t('common.deleteFailed'),
    onSuccess,
  } = options

  const confirmDelete = useCallback(
    (id: string) => {
      Modal.confirm({
        title,
        content,
        okText: i18n.t('common.confirm'),
        cancelText: i18n.t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: async () => {
          const result = await onConfirm(id)
          if (result.success) {
            message.success(successMessage)
            onSuccess?.()
          } else {
            message.error(`${errorMessage}: ${result.error}`)
          }
        },
      })
    },
    [onConfirm, title, content, successMessage, errorMessage, onSuccess]
  )

  return { confirmDelete }
}
