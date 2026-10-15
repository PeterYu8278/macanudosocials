/**
 * 统一按钮组件
 * 提供一致的按钮样式和行为
 */

import React from 'react'
import { Button as AntButton, ButtonProps as AntButtonProps, Tooltip } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { COMMON_ACTIONS, CONTAINER_KEYS } from '../../i18n/constants'

export interface ButtonProps extends Omit<AntButtonProps, 'type' | 'variant'> {
  // 按钮变体
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'ghost' | 'link' | 'text'
  
  // 加载状态
  loading?: boolean
  loadingText?: string
  
  // 提示信息
  tooltip?: string
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
  
  // 确认操作
  confirm?: {
    title: string
    onConfirm: () => void
    onCancel?: () => void
  }
  
  // 样式定制
  fullWidth?: boolean
  gradient?: boolean
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  loading = false,
  loadingText,
  tooltip,
  tooltipPlacement = 'top',
  confirm,
  fullWidth = false,
  gradient = false,
  children,
  style,
  className,
  onClick,
  ...props
}) => {
  const [isConfirming, setIsConfirming] = React.useState(false)

  // 映射变体到 Ant Design 类型
  const getButtonType = (): AntButtonProps['type'] => {
    switch (variant) {
      case 'primary':
      case 'success':
      case 'warning':
      case 'danger':
        return 'primary'
      case 'secondary':
        return 'default'
      case 'ghost':
        return 'default' // Ant Design 5 的 type 不支持 'ghost'，使用 'default' 并通过样式实现 ghost 效果
      case 'link':
        return 'link'
      case 'text':
        return 'text'
      default:
        return 'default'
    }
  }

  // 获取按钮样式
  const getButtonStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      ...style,
      width: fullWidth ? '100%' : style?.width
    }

    // 渐变效果
    if (gradient && variant === 'primary') {
      return {
        ...baseStyle,
        background: 'var(--cigar-gradient-gold, linear-gradient(to right, #FDE08D, #C48D3A))',
        border: 'none'
      }
    }

    // Ghost 变体样式（透明背景，有边框）
    if (variant === 'ghost') {
      return {
        ...baseStyle,
        background: 'transparent',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        color: '#f8f8f8'
      }
    }

    // 变体颜色
    const variantColors: Record<string, React.CSSProperties> = {
      success: {
        background: '#52c41a',
        borderColor: '#52c41a'
      },
      warning: {
        background: '#faad14',
        borderColor: '#faad14'
      },
      danger: {
        background: '#ff4d4f',
        borderColor: '#ff4d4f'
      }
    }

    if (variant in variantColors && getButtonType() === 'primary') {
      return {
        ...baseStyle,
        ...variantColors[variant]
      }
    }

    return baseStyle
  }

  // 处理点击事件
  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (confirm && !isConfirming) {
      setIsConfirming(true)
      // 这里可以集成 Modal.confirm 或自定义确认对话框
      if (window.confirm(confirm.title)) {
        confirm.onConfirm()
      } else {
        confirm.onCancel?.()
      }
      setIsConfirming(false)
    } else {
      onClick?.(e)
    }
  }

  // 渲染按钮内容
  const renderContent = () => {
    if (loading) {
      return (
        <>
          <LoadingOutlined style={{ marginRight: 8 }} />
          {loadingText || children}
        </>
      )
    }
    return children
  }

  // 渲染按钮
  const button = (
    <AntButton
      {...props}
      type={getButtonType()}
      loading={loading}
      danger={variant === 'danger'}
      style={getButtonStyle()}
      className={[className, variant === 'success' || variant === 'warning' ? `cigar-button-${variant}` : ''].filter(Boolean).join(' ')}
      onClick={handleClick}
    >
      {renderContent()}
    </AntButton>
  )

  // 包装 Tooltip
  if (tooltip) {
    return (
      <Tooltip title={tooltip} placement={tooltipPlacement}>
        {button}
      </Tooltip>
    )
  }

  return button
}

/**
 * 预设按钮Hook
 * 使用国际化的按钮预设
 */
export const useButtonPresets = () => {
  const { t } = useTranslation()
  
  return {
    /**
     * 保存按钮
     */
    Save: (props: Partial<ButtonProps>) => (
      <Button variant="primary" {...props}>
        {props.children || t(COMMON_ACTIONS.SAVE)}
      </Button>
    ),

    /**
     * 取消按钮
     */
    Cancel: (props: Partial<ButtonProps>) => (
      <Button variant="secondary" {...props}>
        {props.children || t(COMMON_ACTIONS.CANCEL)}
      </Button>
    ),

    /**
     * 创建按钮
     */
    Create: (props: Partial<ButtonProps>) => (
      <Button variant="primary" {...props}>
        {props.children || t(COMMON_ACTIONS.CREATE)}
      </Button>
    ),

    /**
     * 编辑按钮
     */
    Edit: (props: Partial<ButtonProps>) => (
      <Button variant="primary" {...props}>
        {props.children || t(COMMON_ACTIONS.EDIT)}
      </Button>
    ),

    /**
     * 删除按钮
     */
    Delete: (props: Partial<ButtonProps>) => (
      <Button
        variant="danger"
        confirm={{
          title: t(CONTAINER_KEYS.CONFIRM_DELETE),
          onConfirm: props.onClick as any
        }}
        {...props}
      >
        {props.children || t(COMMON_ACTIONS.DELETE)}
      </Button>
    ),

    /**
     * 确认按钮
     */
    Confirm: (props: Partial<ButtonProps>) => (
      <Button variant="success" {...props}>
        {props.children || t(COMMON_ACTIONS.CONFIRM)}
      </Button>
    ),

    /**
     * 重置按钮
     */
    Reset: (props: Partial<ButtonProps>) => (
      <Button variant="secondary" {...props}>
        {props.children || t(COMMON_ACTIONS.RESET)}
      </Button>
    ),

    /**
     * 提交按钮
     */
    Submit: (props: Partial<ButtonProps>) => (
      <Button variant="primary" htmlType="submit" {...props}>
        {props.children || t(COMMON_ACTIONS.SUBMIT)}
      </Button>
    ),

    /**
     * 关闭按钮
     */
    Close: (props: Partial<ButtonProps>) => (
      <Button variant="text" {...props}>
        {props.children || t(COMMON_ACTIONS.CLOSE)}
      </Button>
    ),

    /**
     * 下载按钮
     */
    Download: (props: Partial<ButtonProps>) => (
      <Button variant="primary" {...props}>
        {props.children || t(COMMON_ACTIONS.DOWNLOAD)}
      </Button>
    ),

    /**
     * 上传按钮
     */
    Upload: (props: Partial<ButtonProps>) => (
      <Button variant="primary" {...props}>
        {props.children || t(COMMON_ACTIONS.UPLOAD)}
      </Button>
    ),

    /**
     * 刷新按钮
     */
    Refresh: (props: Partial<ButtonProps>) => (
      <Button variant="secondary" {...props}>
        {props.children || t(COMMON_ACTIONS.REFRESH)}
      </Button>
    ),

    /**
     * 返回按钮
     */
    Back: (props: Partial<ButtonProps>) => (
      <Button variant="secondary" {...props}>
        {props.children || t(COMMON_ACTIONS.BACK)}
      </Button>
    )
  }
}

/**
 * @deprecated 使用 useButtonPresets Hook 代替
 * 为保持向后兼容性暂时保留，但会在下个版本移除
 */
export const ButtonPresets = {
  Save: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" {...props}>{props.children || t(COMMON_ACTIONS.SAVE)}</Button> },
  Cancel: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="secondary" {...props}>{props.children || t(COMMON_ACTIONS.CANCEL)}</Button> },
  Create: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" {...props}>{props.children || t(COMMON_ACTIONS.CREATE)}</Button> },
  Edit: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" {...props}>{props.children || t(COMMON_ACTIONS.EDIT)}</Button> },
  Delete: (props: Partial<ButtonProps>) => {
    const { t } = useTranslation()
    return (
      <Button variant="danger" confirm={{ title: t(CONTAINER_KEYS.CONFIRM_DELETE), onConfirm: props.onClick as any }} {...props}>
        {props.children || t(COMMON_ACTIONS.DELETE)}
      </Button>
    )
  },
  Confirm: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="success" {...props}>{props.children || t(COMMON_ACTIONS.CONFIRM)}</Button> },
  Reset: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="secondary" {...props}>{props.children || t(COMMON_ACTIONS.RESET)}</Button> },
  Submit: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" htmlType="submit" {...props}>{props.children || t(COMMON_ACTIONS.SUBMIT)}</Button> },
  Close: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="text" {...props}>{props.children || t(COMMON_ACTIONS.CLOSE)}</Button> },
  Download: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" {...props}>{props.children || t(COMMON_ACTIONS.DOWNLOAD)}</Button> },
  Upload: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="primary" {...props}>{props.children || t(COMMON_ACTIONS.UPLOAD)}</Button> },
  Refresh: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="secondary" {...props}>{props.children || t(COMMON_ACTIONS.REFRESH)}</Button> },
  Back: (props: Partial<ButtonProps>) => { const { t } = useTranslation(); return <Button variant="secondary" {...props}>{props.children || t(COMMON_ACTIONS.BACK)}</Button> }
}

export default Button
